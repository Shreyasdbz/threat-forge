#[allow(dead_code)]
#[path = "../../src-tauri/src/models/threat_model.rs"]
mod models;
#[path = "../../src-tauri/src/scene.rs"]
mod scene;

use wasm_bindgen::prelude::*;

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
