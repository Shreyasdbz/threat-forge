use crate::models::{Position, Size, ThreatModel};
use base64::{engine::general_purpose::STANDARD, Engine};
use read_fonts::{collections::IntSet, FontRef};
use resvg::{tiny_skia, usvg};
use skera::{subset_font, Plan, SubsetFlags, DEFAULT_LAYOUT_FEATURES};
use std::collections::HashMap;
use std::fmt::Write;
use std::sync::OnceLock;

pub(crate) const ELEMENT_WIDTH: f64 = 208.0;
pub(crate) const ELEMENT_HEIGHT: f64 = 72.0;
pub(crate) const COLUMN_GAP: f64 = 136.0;
pub(crate) const ROW_GAP: f64 = 136.0;
pub(crate) const CONTAINER_INSET: f64 = 48.0;
const MAX_NODES: usize = 1_000;
const MAX_SIDE: f32 = 2_048.0;
const INTER_FAMILY: &str = "Inter";

fn inter_subset(characters: &IntSet<u32>) -> Result<Vec<u8>, &'static str> {
    const FONT_ERROR: &str = "Could not prepare the diagram font.";
    let font = FontRef::new(include_bytes!("../assets/fonts/InterVariable.ttf"))
        .map_err(|_| FONT_ERROR)?;
    let plan = Plan::new(
        &IntSet::empty(),
        characters,
        &font,
        SubsetFlags::default(),
        &IntSet::empty(),
        &IntSet::all(),
        &DEFAULT_LAYOUT_FEATURES.iter().copied().collect(),
        &IntSet::all(),
        &IntSet::all(),
    );
    subset_font(&font, &plan).map_err(|_| FONT_ERROR)
}

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
    caption: String,
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
                caption: String::new(),
                rect,
                kind: "boundary",
                fill: color(boundary.fill_color.as_deref(), "none"),
                stroke: color(
                    boundary
                        .stroke_color
                        .as_deref()
                        .or(boundary.fill_color.as_deref()),
                    "#a3a5a3",
                ),
                fill_opacity: boundary.fill_opacity.unwrap_or(0.05).clamp(0.0, 1.0) * 0.03,
                stroke_opacity: boundary.stroke_opacity.unwrap_or(0.6).clamp(0.0, 0.6),
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
                caption: String::new(),
                name: &group.name,
                rect,
                kind: "group",
                fill: "none",
                stroke: color(
                    group
                        .stroke_color
                        .as_deref()
                        .or(group.fill_color.as_deref()),
                    "#a3a5a3",
                ),
                fill_opacity: 0.0,
                stroke_opacity: group.stroke_opacity.unwrap_or(0.6).clamp(0.0, 0.6),
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
                caption: if kind == "annotation" || rect.height < 44.0 {
                    String::new()
                } else {
                    let technologies = element.technologies.join(" · ");
                    [element.trust_zone.as_str(), technologies.as_str()]
                        .into_iter()
                        .filter(|part| !part.is_empty())
                        .collect::<Vec<_>>()
                        .join(" / ")
                },
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

    pub fn svg(&self) -> Result<String, &'static str> {
        self.render_svg(true)
    }

    pub fn png(&self) -> Result<Vec<u8>, &'static str> {
        png(&self.render_svg(false)?)
    }

    fn render_svg(&self, embed_font: bool) -> Result<String, &'static str> {
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
        let title = xml_text(rendered_chars(self.title, 240));
        let mut shapes = SvgShapes::default();
        for node in &self.containers {
            node.draw(&mut shapes);
        }
        for edge in &self.edges {
            edge.draw(&mut shapes);
        }
        for node in &self.nodes {
            node.draw(&mut shapes);
        }
        let mut styles = String::new();
        let font = if embed_font && !shapes.characters.is_empty() {
            Some(inter_subset(&shapes.characters)?)
        } else {
            None
        };
        if let Some(font) = font {
            let font = STANDARD.encode(font);
            let license = xml_text(include_str!("../../public/fonts/Inter-OFL.txt").chars());
            let _ = write!(
                styles,
                "<metadata>{license}</metadata><style>@font-face{{font-family:{INTER_FAMILY};src:url(data:font/ttf;base64,{font}) format('truetype');font-weight:100 900;}}</style>",
            );
        }
        let mut svg = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="{:.0}" height="{:.0}" viewBox="{x:.2} {y:.2} {width:.2} {height:.2}">
<title>{title}</title><defs>{styles}<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path fill="#606973" d="M0 0L10 5L0 10z"/></marker></defs>
<rect x="{x:.2}" y="{y:.2}" width="{width:.2}" height="{height:.2}" fill="#f7f8fa"/>
<g font-family="{INTER_FAMILY}, sans-serif" fill="#16181c">"##,
            (width * scale).ceil(),
            (height * scale).ceil(),
        );
        svg.push_str(&shapes.markup);
        svg.push_str("</g></svg>\n");
        Ok(svg)
    }
}

#[derive(Default)]
struct SvgShapes {
    markup: String,
    characters: IntSet<u32>,
}

impl SvgShapes {
    fn text(&mut self, text: &str, max_chars: usize) -> String {
        xml_text(rendered_chars(text, max_chars).inspect(|ch| {
            self.characters.insert(u32::from(*ch));
        }))
    }
}

impl Node<'_> {
    fn draw(&self, shapes: &mut SvgShapes) {
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
            10
        } else {
            6
        };
        let label = shapes.text(self.name, (width / 8.0).floor().max(1.0) as usize);
        let (label_x, label_y, font_size, weight, anchor, ink) = if is_container {
            (x + 30.0, y + 25.0, 13, 500, "start", "#505863")
        } else {
            (
                x + width / 2.0,
                y + height / 2.0 + if self.caption.is_empty() { 5.0 } else { -4.0 },
                14,
                600,
                "middle",
                "#16181c",
            )
        };
        let svg = &mut shapes.markup;
        let _ = writeln!(
            svg,
            r#"<g class="{}"><rect x="{x:.2}" y="{y:.2}" width="{width:.2}" height="{height:.2}" rx="{rx}" fill="{}" fill-opacity="{:.3}" stroke="{}" stroke-opacity="{:.2}"{dash}/>"#,
            self.kind, self.fill, self.fill_opacity, self.stroke, self.stroke_opacity,
        );
        if is_container {
            let _ = writeln!(
                svg,
                r#"<circle cx="{:.2}" cy="{:.2}" r="3" fill="{}"/>"#,
                x + 19.0,
                y + 21.0,
                self.stroke,
            );
        }
        let _ = writeln!(
            svg,
            r#"<text x="{label_x:.2}" y="{label_y:.2}" font-size="{font_size}" font-weight="{weight}" text-anchor="{anchor}" fill="{ink}">{label}</text>"#,
        );
        if !self.caption.is_empty() {
            let caption = shapes.text(&self.caption, (width / 7.0).floor().max(1.0) as usize);
            let caption_y = label_y + 17.0;
            let _ = writeln!(
                shapes.markup,
                r##"<text x="{label_x:.2}" y="{caption_y:.2}" font-size="12" font-weight="400" text-rendering="geometricPrecision" style="font-kerning:normal" text-anchor="middle" fill="#505863">{caption}</text>"##,
            );
        }
        shapes.markup.push_str("</g>\n");
    }
}

impl Edge<'_> {
    fn draw(&self, shapes: &mut SvgShapes) {
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
        let label = shapes.text(self.name, 80);
        let dash = if self.dashed {
            r#" stroke-dasharray="6 4""#
        } else {
            ""
        };
        let _ = writeln!(
            shapes.markup,
            r##"<path d="{path}" fill="none" stroke="#606973" stroke-width="1.25" marker-end="url(#arrow)"{dash}/><text x="{label_x:.2}" y="{label_y:.2}" text-anchor="{anchor}" font-size="13" font-weight="500" fill="#505863">{label}</text>"##
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

fn rendered_chars(text: &str, max_chars: usize) -> impl Iterator<Item = char> + '_ {
    text.chars()
        .filter(|ch| !ch.is_control() && *ch != '\u{fffe}' && *ch != '\u{ffff}')
        .take(max_chars)
}

fn xml_text(text: impl Iterator<Item = char>) -> String {
    let mut output = String::new();
    for ch in text {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            _ => output.push(ch),
        }
    }
    output
}

fn png(svg: &str) -> Result<Vec<u8>, &'static str> {
    static FONTS: OnceLock<std::sync::Arc<usvg::fontdb::Database>> = OnceLock::new();
    let fontdb = FONTS.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        for face in [
            include_bytes!("../assets/fonts/Inter-Regular.ttf").as_slice(),
            include_bytes!("../assets/fonts/Inter-Medium.ttf").as_slice(),
            include_bytes!("../assets/fonts/Inter-SemiBold.ttf").as_slice(),
        ] {
            db.load_font_data(face.to_vec());
        }
        db.load_font_data(include_bytes!("../assets/fonts/DejaVuSans.ttf").to_vec());
        db.set_sans_serif_family(INTER_FAMILY);
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

#[cfg(test)]
mod tests {
    use super::*;
    use read_fonts::TableProvider;

    #[test]
    fn subset_keeps_rendered_characters_and_layout() {
        let mut shapes = SvgShapes::default();
        assert_eq!(shapes.text("A&VàZ", 4), "A&amp;Và");
        let bytes = inter_subset(&shapes.characters).unwrap();
        let face = FontRef::new(&bytes).unwrap();
        let cmap = face.cmap().unwrap();
        for ch in ['A', '&', 'V', 'à'] {
            assert!(cmap.map_codepoint(ch).is_some(), "missing {ch}");
        }
        for ch in ['Z', 'm', 'p', ';'] {
            assert!(cmap.map_codepoint(ch).is_none(), "unexpected {ch}");
        }
        assert!(face.gpos().is_ok());
        assert!(face.fvar().is_ok());
    }
}
