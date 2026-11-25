use crate::file_io;
use crate::models::ThreatModel;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const UNAPPROVED: &str = "Choose the file in a native file dialog first.";

#[derive(Default)]
pub struct ApprovedDocuments(Mutex<HashSet<PathBuf>>);

impl ApprovedDocuments {
    pub fn approve(&self, path: &Path) -> Result<PathBuf, String> {
        let path = selected_path(path, "thf")?;
        self.0.lock().map_err(|_| UNAPPROVED)?.insert(path.clone());
        Ok(path)
    }

    fn require(&self, path: &Path) -> Result<PathBuf, String> {
        let path = selected_path(path, "thf")?;
        if !self.0.lock().map_err(|_| UNAPPROVED)?.contains(&path) {
            return Err(UNAPPROVED.into());
        }
        Ok(path)
    }
}

pub(super) fn selected_path(path: &Path, extension: &str) -> Result<PathBuf, String> {
    if !path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
    {
        return Err(format!("Choose a .{extension} file."));
    }
    file_io::resolve_target(path).map_err(|error| error.user_message())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    model: ThreatModel,
    path: PathBuf,
    revision: String,
    source_yaml: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDocument {
    path: PathBuf,
    revision: String,
    source_yaml: String,
}

#[tauri::command]
pub fn create_new_model(title: String, author: String) -> Result<ThreatModel, String> {
    Ok(ThreatModel::new(&title, &author))
}

#[tauri::command]
pub async fn open_threat_model(
    app: AppHandle,
    approved: State<'_, ApprovedDocuments>,
    path: Option<PathBuf>,
) -> Result<Option<OpenedDocument>, String> {
    let path = match path {
        Some(path) => approved.require(&path)?,
        None => {
            let Some(picked) = app
                .dialog()
                .file()
                .add_filter("ThreatForge model", &["thf"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            approved.approve(&picked.into_path().map_err(|_| UNAPPROVED)?)?
        }
    };
    let snapshot = file_io::read_document(&path).map_err(|error| error.user_message())?;
    opened_document(path, snapshot).map(Some)
}

#[tauri::command]
pub async fn check_document_update(
    approved: State<'_, ApprovedDocuments>,
    path: PathBuf,
    revision: String,
) -> Result<Option<OpenedDocument>, String> {
    let path = approved.require(&path)?;
    file_io::read_document_if_changed(&path, &revision)
        .map_err(|error| error.user_message())?
        .map(|snapshot| opened_document(path, snapshot))
        .transpose()
}

fn opened_document(
    path: PathBuf,
    mut snapshot: file_io::DocumentSnapshot,
) -> Result<OpenedDocument, String> {
    file_io::merge_layout_into_model(&mut snapshot.model, &path);
    let source_yaml = snapshot
        .source_yaml()
        .map_err(|error| error.user_message())?;
    Ok(OpenedDocument {
        model: snapshot.model,
        path,
        revision: snapshot.revision,
        source_yaml,
    })
}

#[tauri::command]
pub async fn save_threat_model(
    app: AppHandle,
    approved: State<'_, ApprovedDocuments>,
    path: Option<PathBuf>,
    expected_revision: Option<String>,
    save_as: bool,
    model: ThreatModel,
    source_yaml: Option<String>,
) -> Result<Option<SavedDocument>, String> {
    let (path, is_copy) = match (path, save_as) {
        (Some(path), false) => (approved.require(&path)?, false),
        (current, _) => {
            let Some(picked) = app
                .dialog()
                .file()
                .add_filter("ThreatForge model", &["thf"])
                .set_file_name("model.thf")
                .blocking_save_file()
            else {
                return Ok(None);
            };
            let path = approved.approve(&picked.into_path().map_err(|_| UNAPPROVED)?)?;
            let is_copy = current.as_deref() != Some(&path);
            (path, is_copy)
        }
    };
    let written = if is_copy {
        let destination_revision =
            file_io::destination_revision(&path).map_err(|error| error.user_message())?;
        file_io::copy_document(
            &path,
            destination_revision.as_deref(),
            model,
            source_yaml.as_deref(),
        )
    } else {
        let expected_revision =
            expected_revision.ok_or("Reopen the file before saving, or save to a new file.")?;
        file_io::write_document(&path, Some(&expected_revision), model)
    }
    .map_err(|error| error.user_message())?;
    Ok(Some(SavedDocument {
        path,
        revision: written.revision,
        source_yaml: written.yaml,
    }))
}

#[tauri::command]
pub async fn export_html(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<PathBuf>, String> {
    let name = default_name.rsplit(['/', '\\']).next().unwrap_or("report");
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("HTML report", &["html"])
        .set_file_name(format!("{name}.html"))
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = selected_path(&picked.into_path().map_err(|_| UNAPPROVED)?, "html")?;
    file_io::atomic_write(&path, content.as_bytes()).map_err(|error| error.user_message())?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approving_a_document_does_not_approve_siblings_or_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let document = dir.path().join("approved.thf");
        let grants = ApprovedDocuments::default();
        assert!(grants.require(&document).is_err());
        let approved = grants.approve(&document).unwrap();
        assert_eq!(grants.require(&document).unwrap(), approved);
        assert!(grants.require(&dir.path().join("other.thf")).is_err());
        assert!(grants
            .require(&dir.path().join("other/../approved.thf"))
            .is_err());
        assert!(grants.approve(&dir.path().join("approval.html")).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("private.thf"), &document).unwrap();
            assert!(grants.require(&document).is_err());
        }
    }

    #[test]
    fn desktop_update_check_ignores_own_revision_and_loads_atomic_external_edits() {
        let dir = tempfile::tempdir().unwrap();
        let grants = ApprovedDocuments::default();
        let path = grants.approve(&dir.path().join("model.thf")).unwrap();
        let first = file_io::write_document(&path, None, ThreatModel::new("First", "")).unwrap();
        assert!(file_io::read_document_if_changed(&path, &first.revision)
            .unwrap()
            .is_none());

        let second = file_io::write_document(
            &path,
            Some(&first.revision),
            ThreatModel::new("External", ""),
        )
        .unwrap();
        let update = file_io::read_document_if_changed(&path, &first.revision)
            .unwrap()
            .unwrap();
        let opened = opened_document(path.clone(), update).unwrap();
        assert_eq!(opened.model.metadata.title, "External");
        assert_eq!(opened.revision, second.revision);

        std::fs::write(&path, "invalid: [").unwrap();
        assert!(file_io::read_document_if_changed(&path, &second.revision).is_err());
    }
}
