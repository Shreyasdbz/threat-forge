use crate::file_io::{copy_document, read_document, write_document};
use crate::models::ThreatModel;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

const MAX_DOCUMENTS: usize = 16;
const MAX_EDITS: usize = 20;

#[derive(Default)]
pub(super) struct Journal {
    documents: VecDeque<(PathBuf, DocumentHistory)>,
}

#[derive(Default)]
struct DocumentHistory {
    revision: String,
    undo: VecDeque<Edit>,
    redo: Vec<Edit>,
}

struct Edit {
    before: String,
    after: String,
}

impl Journal {
    pub fn commit(
        &mut self,
        path: &Path,
        revision: &str,
        model: ThreatModel,
    ) -> Result<String, String> {
        let before = read_document(path).map_err(|error| error.user_message())?;
        if before.revision != revision {
            return Err(crate::errors::ThreatForgeError::DocumentConflict.user_message());
        }
        let before = before.source_yaml().map_err(|error| error.user_message())?;
        let written =
            write_document(path, Some(revision), model).map_err(|error| error.user_message())?;
        if written.revision != revision {
            let history = self.history(path);
            if history.revision != revision {
                *history = DocumentHistory::default();
            }
            history.revision.clone_from(&written.revision);
            history.redo.clear();
            if history.undo.len() == MAX_EDITS {
                history.undo.pop_front();
            }
            history.undo.push_back(Edit {
                before,
                after: written.yaml,
            });
        }
        Ok(written.revision)
    }

    pub fn replay(&mut self, path: &Path, redo: bool) -> Result<String, String> {
        let history = self.history(path);
        let edit = if redo {
            history.redo.last()
        } else {
            history.undo.back()
        }
        .ok_or(if redo {
            "No edit to redo."
        } else {
            "No edit to undo."
        })?;
        let yaml = if redo { &edit.after } else { &edit.before };
        let model = serde_yaml::from_str(yaml).map_err(|_| "The journal entry is invalid.")?;
        let written = copy_document(path, Some(&history.revision), model, Some(yaml))
            .map_err(|error| error.user_message())?;
        history.revision.clone_from(&written.revision);
        if redo {
            history.undo.extend(history.redo.pop());
        } else {
            history.redo.extend(history.undo.pop_back());
        }
        Ok(written.revision)
    }

    fn history(&mut self, path: &Path) -> &mut DocumentHistory {
        let history = self
            .documents
            .iter()
            .position(|(key, _)| key == path)
            .and_then(|index| self.documents.remove(index));
        if self.documents.len() >= MAX_DOCUMENTS {
            self.documents.pop_front();
        }
        let index = self.documents.len();
        self.documents
            .push_back(history.unwrap_or_else(|| (path.to_path_buf(), DocumentHistory::default())));
        &mut self.documents[index].1
    }
}
