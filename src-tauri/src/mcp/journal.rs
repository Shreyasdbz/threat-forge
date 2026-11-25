use crate::file_io::WriteTarget;
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
    before: Vec<u8>,
    after: Vec<u8>,
}

impl Journal {
    pub fn commit(
        &mut self,
        target: &WriteTarget,
        revision: &str,
        model: ThreatModel,
    ) -> Result<String, String> {
        let before = target
            .read_document()
            .map_err(|error| error.user_message())?;
        if before.revision != revision {
            return Err(crate::errors::ThreatForgeError::DocumentConflict.user_message());
        }
        let written = target
            .write_document(Some(revision), model)
            .map_err(|error| error.user_message())?;
        if written.revision != revision {
            let history = self.history(target.path());
            if history.revision != revision {
                *history = DocumentHistory::default();
            }
            history.revision.clone_from(&written.revision);
            history.redo.clear();
            if history.undo.len() == MAX_EDITS {
                history.undo.pop_front();
            }
            history.undo.push_back(Edit {
                before: before.bytes,
                after: written.yaml.into_bytes(),
            });
        }
        Ok(written.revision)
    }

    pub fn replay(&mut self, target: &WriteTarget, redo: bool) -> Result<String, String> {
        let no_edit = if redo {
            "No edit to redo."
        } else {
            "No edit to undo."
        };
        let (_, history) = self
            .documents
            .iter_mut()
            .find(|(path, _)| path == target.path())
            .ok_or(no_edit)?;
        let edit = if redo {
            history.redo.last()
        } else {
            history.undo.back()
        }
        .ok_or(no_edit)?;
        let yaml = if redo { &edit.after } else { &edit.before };
        let revision = target
            .restore_document(&history.revision, yaml)
            .map_err(|error| error.user_message())?;
        history.revision.clone_from(&revision);
        if redo {
            history.undo.extend(history.redo.pop());
        } else {
            history.redo.extend(history.undo.pop_back());
        }
        self.history(target.path());
        Ok(revision)
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
