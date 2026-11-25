use crate::models::{Position, Size, ThreatModel};
use crate::scene::{COLUMN_GAP, CONTAINER_INSET, ELEMENT_HEIGHT, ELEMENT_WIDTH, ROW_GAP};
use std::collections::HashSet;

pub(super) const MAX_COORD: f64 = 100_000.0;

pub(super) fn size_of(size: Option<&Size>) -> Size {
    size.cloned().unwrap_or(Size {
        width: ELEMENT_WIDTH,
        height: ELEMENT_HEIGHT,
    })
}

pub(super) fn position(
    model: &mut ThreatModel,
    id: &str,
    x: f64,
    y: f64,
    relative: bool,
) -> Result<(), String> {
    let slot = if let Some(element) = model.elements.iter_mut().find(|node| node.id == id) {
        &mut element.position
    } else if let Some(boundary) = model.trust_boundaries.iter_mut().find(|node| node.id == id) {
        &mut boundary.position
    } else if let Some(group) = model.groups.iter_mut().find(|node| node.id == id) {
        &mut group.position
    } else {
        return Err(format!("Node not found: {id}"));
    };
    let (x, y) = match (relative, slot.as_ref()) {
        (true, Some(old)) => (x + old.x, y + old.y),
        _ => (x, y),
    };
    if ![x, y]
        .into_iter()
        .all(|value| value.is_finite() && value.abs() <= MAX_COORD)
    {
        return Err("Positions must be finite and within ±100,000 units.".into());
    }
    *slot = Some(Position { x, y });
    Ok(())
}

pub(super) fn resize(
    model: &mut ThreatModel,
    id: &str,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if ![width, height]
        .into_iter()
        .all(|value| (16.0..=4096.0).contains(&value))
    {
        return Err("Width and height must each be between 16 and 4096 units.".into());
    }
    let slot = if let Some(element) = model.elements.iter_mut().find(|node| node.id == id) {
        &mut element.size
    } else if let Some(boundary) = model.trust_boundaries.iter_mut().find(|node| node.id == id) {
        &mut boundary.size
    } else if let Some(group) = model.groups.iter_mut().find(|node| node.id == id) {
        &mut group.size
    } else {
        return Err(format!("Node not found: {id}"));
    };
    *slot = Some(Size { width, height });
    Ok(())
}

fn grid(index: usize, width: f64, height: f64) -> Position {
    Position {
        x: CONTAINER_INSET + (index % 4) as f64 * width,
        y: CONTAINER_INSET + (index / 4) as f64 * height,
    }
}

pub(super) fn arrange(model: &mut ThreatModel) {
    let mut seen = HashSet::new();
    let mut offset_y = 0.0;
    let (width, height) = model.elements.iter().fold(
        (ELEMENT_WIDTH + COLUMN_GAP, ELEMENT_HEIGHT + ROW_GAP),
        |(width, height), node| {
            let size = size_of(node.size.as_ref());
            (
                width.max(size.width + COLUMN_GAP),
                height.max(size.height + ROW_GAP),
            )
        },
    );
    for boundary in &mut model.trust_boundaries {
        let mut count = 0usize;
        for element in &mut model.elements {
            if boundary.contains.contains(&element.id) && seen.insert(element.id.clone()) {
                element.position = Some(grid(count, width, height));
                count += 1;
            }
        }
        let size = Size {
            width: count.clamp(1, 4) as f64 * width,
            height: count.max(1).div_ceil(4) as f64 * height,
        };
        boundary.position = Some(Position {
            x: 0.0,
            y: offset_y,
        });
        offset_y += size.height + ROW_GAP;
        boundary.size = Some(size);
    }
    for (index, element) in model
        .elements
        .iter_mut()
        .filter(|node| !seen.contains(&node.id))
        .enumerate()
    {
        let mut position = grid(index, width, height);
        position.y += offset_y;
        element.position = Some(position);
    }
}
