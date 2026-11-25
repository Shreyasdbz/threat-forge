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

fn svg(model: &str) -> Result<String, JsError> {
    let model = serde_json::from_str(model).map_err(|_| JsError::new("Invalid diagram model."))?;
    Ok(scene::Scene::from_model(&model)
        .map_err(JsError::new)?
        .svg())
}

#[wasm_bindgen]
pub fn render_svg(model: &str) -> Result<String, JsError> {
    svg(model)
}

#[wasm_bindgen]
pub fn render_png(model: &str) -> Result<Vec<u8>, JsError> {
    scene::png(&svg(model)?).map_err(JsError::new)
}
