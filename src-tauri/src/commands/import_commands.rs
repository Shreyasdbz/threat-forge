use crate::importers::tm7;
use crate::models::ThreatModel;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn import_threat_model(app: AppHandle) -> Result<Option<ThreatModel>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Microsoft Threat Model", &["tm7"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = super::file_commands::selected_path(
        &picked
            .into_path()
            .map_err(|_| "Choose a local .tm7 file.")?,
        "tm7",
    )?;
    let contents =
        std::fs::read_to_string(&path).map_err(|_| "Could not read the selected file.")?;
    tm7::parse_tm7(&contents)
        .map(Some)
        .map_err(|_| "Could not import the selected .tm7 file.".into())
}
