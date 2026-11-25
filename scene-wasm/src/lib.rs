#[allow(dead_code)]
#[path = "../../src-tauri/src/models/threat_model.rs"]
mod models;
#[path = "../../src-tauri/src/scene.rs"]
mod scene;
#[path = "../../src-tauri/src/importers/tm7.rs"]
mod tm7;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn import_tm7(source: &str) -> Result<String, JsError> {
    let invalid = || JsError::new("Could not import the selected .tm7 file.");
    let model = tm7::parse_tm7(source).map_err(|_| invalid())?;
    serde_json::to_string(&model).map_err(|_| invalid())
}

fn parse_model(model: &str) -> Result<models::ThreatModel, JsError> {
    serde_json::from_str(model).map_err(|_| JsError::new("Invalid diagram model."))
}

#[wasm_bindgen]
pub fn render_svg(model: &str) -> Result<String, JsError> {
    scene::Scene::from_model(&parse_model(model)?)
        .and_then(|scene| scene.svg())
        .map_err(JsError::new)
}

#[wasm_bindgen]
pub fn render_png(model: &str) -> Result<Vec<u8>, JsError> {
    scene::Scene::from_model(&parse_model(model)?)
        .and_then(|scene| scene.png())
        .map_err(JsError::new)
}
