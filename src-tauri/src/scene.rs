use crate::models::{Position, Size, ThreatModel};
use resvg::{tiny_skia, usvg};
use std::collections::HashMap;
use std::fmt::Write;
use std::sync::OnceLock;

pub(crate) const ELEMENT_WIDTH: f64 = 176.0;
pub(crate) const ELEMENT_HEIGHT: f64 = 72.0;
pub(crate) const COLUMN_GAP: f64 = 136.0;
pub(crate) const ROW_GAP: f64 = 136.0;
pub(crate) const CONTAINER_INSET: f64 = 48.0;
const MAX_NODES: usize = 1_000;
const MAX_SIDE: f32 = 2_048.0;

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn new(position: Option<&Position>, size: Option<&Size>, fallback: Self) -> Self {
        Self {
            x: position.map_or(fallback.x, |p| {
                bounded(p.x, fallback.x, -100_000.0, 100_000.0)
            }),
            y: position.map_or(fallback.y, |p| {
                bounded(p.y, fallback.y, -100_000.0, 100_000.0)
            }),
            width: size.map_or(fallback.width, |s| {
                bounded(s.width, fallback.width, 16.0, 20_000.0)
            }),
            height: size.map_or(fallback.height, |s| {
                bounded(s.height, fallback.height, 16.0, 20_000.0)
            }),
        }
    }

    fn center(self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }

    fn toward(self, target: (f64, f64)) -> (f64, f64) {
        let (x, y) = self.center();
        let (dx, dy) = (target.0 - x, target.1 - y);
        let scale = (dx.abs() / (self.width / 2.0))
            .max(dy.abs() / (self.height / 2.0))
            .max(1.0);
        (x + dx / scale, y + dy / scale)
    }
}

struct Node<'a> {
    name: &'a str,
    rect: Rect,
    fill: &'a str,
    stroke: &'a str,
    fill_opacity: f64,
    stroke_opacity: f64,
    kind: &'static str,
}

struct Edge<'a> {
    from: Rect,
    to: Rect,
    name: &'a str,
    dashed: bool,
    loops: bool,
    lane: usize,
}

pub(crate) struct Scene<'a> {
    title: &'a str,
    containers: Vec<Node<'a>>,
    nodes: Vec<Node<'a>>,
    edges: Vec<Edge<'a>>,
}

impl<'a> Scene<'a> {
    pub fn from_model(model: &'a ThreatModel) -> Result<Self, &'static str> {
        if model.elements.len()
            + model.groups.len()
            + model.trust_boundaries.len()
            + model.data_flows.len()
            + model.relationships.len()
            > MAX_NODES
        {
            return Err("The diagram is too large to render.");
        }
        let mut containers = Vec::new();
        let mut nodes = Vec::new();
        let mut rects = HashMap::new();
        let mut membership = HashMap::new();
        for (i, boundary) in model.trust_boundaries.iter().enumerate() {
            let rect = Rect::new(
                boundary.position.as_ref(),
                boundary.size.as_ref(),
                Rect {
                    x: 0.0,
                    y: i as f64 * 360.0,
                    width: 640.0,
                    height: 300.0,
                },
            );
            for id in &boundary.contains {
                membership.insert(id.as_str(), rect);
            }
            containers.push(Node {
                name: &boundary.name,
                rect,
                kind: "boundary",
                fill: color(boundary.fill_color.as_deref(), "none"),
                stroke: color(boundary.stroke_color.as_deref(), "#a3a5a3"),
                fill_opacity: opacity(boundary.fill_opacity),
                stroke_opacity: opacity(boundary.stroke_opacity),
            });
        }
        for (i, group) in model.groups.iter().enumerate() {
            let rect = Rect::new(
                group.position.as_ref(),
                group.size.as_ref(),
                Rect {
                    x: 680.0,
                    y: i as f64 * 320.0,
                    width: 420.0,
                    height: 280.0,
                },
            );
            rects.insert(group.id.as_str(), rect);
            containers.push(Node {
                name: &group.name,
                rect,
                kind: "group",
                fill: color(group.fill_color.as_deref(), "none"),
                stroke: color(group.stroke_color.as_deref(), "#a3a5a3"),
                fill_opacity: opacity(group.fill_opacity),
                stroke_opacity: opacity(group.stroke_opacity),
            });
        }
        let mut group_positions = HashMap::new();
        for (i, element) in model.elements.iter().enumerate() {
            let boundary = membership.get(element.id.as_str());
            let group = element.group.as_deref().and_then(|id| rects.get(id));
            let container = boundary.or(group);
            let local_index = container.map_or(i, |rect| {
                let counter = group_positions
                    .entry((rect.x.to_bits(), rect.y.to_bits()))
                    .or_insert(0);
                let index = *counter;
                *counter += 1;
                index
            });
            let mut rect = Rect::new(
                element.position.as_ref(),
                element.size.as_ref(),
                Rect {
                    x: CONTAINER_INSET + (local_index % 4) as f64 * (ELEMENT_WIDTH + COLUMN_GAP),
                    y: CONTAINER_INSET + (local_index / 4) as f64 * (ELEMENT_HEIGHT + ROW_GAP),
                    width: ELEMENT_WIDTH,
                    height: ELEMENT_HEIGHT,
                },
            );
            // Trust boundary children use relative coordinates in the editor. Architecture
            // groups supply a fallback origin only when an element has no explicit position.
            if let Some(parent) = boundary.or(group.filter(|_| element.position.is_none())) {
                rect.x += parent.x;
                rect.y += parent.y;
            }
            rects.insert(element.id.as_str(), rect);
            let kind = match element.element_type.as_str() {
                "data_store" => "data-store",
                "external_entity" => "external-entity",
                "text" => "annotation",
                _ => "process",
            };
            nodes.push(Node {
                name: &element.name,
                rect,
                kind,
                fill: color(element.fill_color.as_deref(), "#ffffff"),
                stroke: color(element.stroke_color.as_deref(), "#a3a5a3"),
                fill_opacity: opacity(element.fill_opacity),
                stroke_opacity: opacity(element.stroke_opacity),
            });
        }
        let mut lanes = HashMap::new();
        let mut edge = |from: &'a str, to: &'a str, name, dashed| {
            let from_rect = *rects.get(from)?;
            let to_rect = *rects.get(to)?;
            let lane = lanes.entry((from, to)).or_insert(0);
            let index = *lane;
            *lane += 1;
            Some(Edge {
                from: from_rect,
                to: to_rect,
                name,
                dashed,
                loops: from == to,
                lane: index,
            })
        };
        let mut edges: Vec<_> = model
            .data_flows
            .iter()
            .filter_map(|f| {
                edge(
                    &f.from,
                    &f.to,
                    if f.name.is_empty() {
                        &f.protocol
                    } else {
                        &f.name
                    },
                    false,
                )
            })
            .collect();
        edges.extend(model.relationships.iter().filter_map(|r| {
            edge(
                &r.from,
                &r.to,
                r.name.as_deref().unwrap_or(&r.relationship_type),
                true,
            )
        }));
        Ok(Self {
            title: &model.metadata.title,
            containers,
            nodes,
            edges,
        })
    }

    pub fn svg(&self) -> String {
        let (mut x, mut y, mut right, mut bottom) = (0.0_f64, 0.0_f64, 320.0_f64, 160.0_f64);
        for node in self.containers.iter().chain(&self.nodes) {
            let r = node.rect;
            x = x.min(r.x - 64.0);
            y = y.min(r.y - 80.0);
            right = right.max(r.x + r.width + 64.0);
            bottom = bottom.max(r.y + r.height + 64.0);
        }
        let (width, height) = (right - x, bottom - y);
        let scale = (f64::from(MAX_SIDE) / width.max(height)).min(1.0);
        let title = xml_text(self.title, 240);
        let mut svg = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="{:.0}" height="{:.0}" viewBox="{x:.2} {y:.2} {width:.2} {height:.2}">
<title>{title}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path fill="#656967" d="M0 0L10 5L0 10z"/></marker></defs>
<rect x="{x:.2}" y="{y:.2}" width="{width:.2}" height="{height:.2}" fill="#f7f8f7"/>
<g font-family="sans-serif" fill="#202321">"##,
            (width * scale).ceil(),
            (height * scale).ceil(),
        );
        for node in &self.containers {
            node.draw(&mut svg);
        }
        for edge in &self.edges {
            edge.draw(&mut svg);
        }
        for node in &self.nodes {
            node.draw(&mut svg);
        }
        svg.push_str("</g></svg>\n");
        svg
    }
}

impl Node<'_> {
    fn draw(&self, svg: &mut String) {
        let Rect {
            x,
            y,
            width,
            height,
        } = self.rect;
        let dash = if self.kind == "boundary" {
            r#" stroke-dasharray="5 5""#
        } else {
            ""
        };
        let is_container = matches!(self.kind, "boundary" | "group");
        let rx = if is_container || self.kind == "process" {
            12
        } else {
            6
        };
        let label = xml_text(self.name, (width / 8.0).floor().max(1.0) as usize);
        let (label_x, label_y, font_size, anchor, ink) = if is_container {
            let inset_y = if self.kind == "boundary" { 16.0 } else { 24.0 };
            (x + 16.0, y + inset_y, 12, "start", "#555a57")
        } else {
            (
                x + width / 2.0,
                y + height / 2.0 + 5.0,
                14,
                "middle",
                "#202321",
            )
        };
        let _ = writeln!(
            svg,
            r#"<g class="{}"><rect x="{x:.2}" y="{y:.2}" width="{width:.2}" height="{height:.2}" rx="{rx}" fill="{}" fill-opacity="{:.2}" stroke="{}" stroke-opacity="{:.2}"{dash}/><text x="{label_x:.2}" y="{label_y:.2}" font-size="{font_size}" text-anchor="{anchor}" fill="{ink}">{label}</text></g>"#,
            self.kind, self.fill, self.fill_opacity, self.stroke, self.stroke_opacity,
        );
    }
}

impl Edge<'_> {
    fn draw(&self, svg: &mut String) {
        let (x, y) = self.from.toward(self.to.center());
        let (to_x, to_y) = self.to.toward(self.from.center());
        let mid_x = (x + to_x) / 2.0;
        let mid_y = (y + to_y) / 2.0;
        let offset = self.lane as f64 * 36.0;
        let (path, label_x, label_y, anchor) = if self.loops {
            let (cx, _) = self.from.center();
            let top = self.from.y;
            (
                format!(
                    "M{:.2} {top:.2} C{:.2} {:.2} {:.2} {:.2} {:.2} {top:.2}",
                    cx - 16.0,
                    cx - 36.0,
                    top - 54.0 - offset,
                    cx + 36.0,
                    top - 54.0 - offset,
                    cx + 16.0
                ),
                cx,
                top - 46.0 - offset * 0.75,
                "middle",
            )
        } else if (to_y - y).abs() > (to_x - x).abs() {
            let bend = mid_x + offset;
            (
                format!("M{x:.2} {y:.2} Q{bend:.2} {mid_y:.2} {to_x:.2} {to_y:.2}"),
                mid_x
                    + if self.lane == 0 {
                        -7.0
                    } else {
                        offset / 2.0 + 7.0
                    },
                mid_y + 4.0 + self.lane.saturating_sub(1) as f64 * 14.0,
                if self.lane == 0 { "end" } else { "start" },
            )
        } else {
            let bend = mid_y + offset;
            (
                format!("M{x:.2} {y:.2} Q{mid_x:.2} {bend:.2} {to_x:.2} {to_y:.2}"),
                mid_x,
                mid_y + offset / 2.0 + if self.lane == 0 { -8.0 } else { 14.0 },
                "middle",
            )
        };
        let label = xml_text(self.name, 80);
        let dash = if self.dashed {
            r#" stroke-dasharray="6 4""#
        } else {
            ""
        };
        let _ = writeln!(
            svg,
            r##"<path d="{path}" fill="none" stroke="#656967" stroke-width="1.25" marker-end="url(#arrow)"{dash}/><text x="{label_x:.2}" y="{label_y:.2}" text-anchor="{anchor}" font-size="12" fill="#555a57">{label}</text>"##
        );
    }
}

fn opacity(value: Option<f64>) -> f64 {
    bounded(value.unwrap_or(1.0), 1.0, 0.0, 1.0)
}

fn bounded(value: f64, fallback: f64, min: f64, max: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

fn color<'a>(value: Option<&'a str>, fallback: &'a str) -> &'a str {
    value
        .filter(|value| {
            matches!(value.len(), 4 | 7)
                && value.starts_with('#')
                && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        })
        .unwrap_or(fallback)
}

fn xml_text(text: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for ch in text
        .chars()
        .filter(|ch| !ch.is_control() && *ch != '\u{fffe}' && *ch != '\u{ffff}')
        .take(max_chars)
    {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            _ => output.push(ch),
        }
    }
    output
}

pub(crate) fn png(svg: &str) -> Result<Vec<u8>, &'static str> {
    static FONTS: OnceLock<std::sync::Arc<usvg::fontdb::Database>> = OnceLock::new();
    let fontdb = FONTS.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_font_data(include_bytes!("../assets/fonts/DejaVuSans.ttf").to_vec());
        db.set_sans_serif_family("DejaVu Sans");
        std::sync::Arc::new(db)
    });
    let options = usvg::Options {
        font_family: "sans-serif".into(),
        fontdb: fontdb.clone(),
        ..Default::default()
    };
    let tree = usvg::Tree::from_str(svg, &options).map_err(|_| "Could not render the diagram.")?;
    let size = tree.size().to_int_size();
    if size.width() > MAX_SIDE as u32 || size.height() > MAX_SIDE as u32 {
        return Err("The diagram is too large to render.");
    }
    let mut pixmap = tiny_skia::Pixmap::new(size.width(), size.height())
        .ok_or("Could not allocate the diagram image.")?;
    resvg::render(
        &tree,
        tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    pixmap
        .encode_png()
        .map_err(|_| "Could not encode the diagram as PNG.")
}
