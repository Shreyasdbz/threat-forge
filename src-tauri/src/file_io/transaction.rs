use super::reader::{validate_model, LegacyLayouts};
use crate::errors::ThreatForgeError;
use crate::models::ThreatModel;
use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use serde_yaml::{Mapping, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

const MAX_LAYOUT_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_LAYOUT_TOTAL_BYTES: u64 = 16 * 1024 * 1024;

pub struct DocumentSnapshot {
    pub model: ThreatModel,
    pub revision: String,
    raw: Value,
    pub(crate) bytes: Vec<u8>,
}

pub struct WrittenDocument {
    pub revision: String,
    pub yaml: String,
}

#[cfg(test)]
pub fn read_document(path: &Path) -> Result<DocumentSnapshot, ThreatForgeError> {
    parse_document(path, &read_bytes(path)?)
}

pub(crate) fn read_document_if_changed(
    path: &Path,
    expected: &str,
) -> Result<Option<DocumentSnapshot>, ThreatForgeError> {
    let snapshot = read_desktop_document(path)?;
    if snapshot.revision == expected {
        return Ok(None);
    }
    let layout = desktop_layout_state(&snapshot.revision);
    if layout.is_some_and(|layout| layout.starts_with("unavailable:"))
        && layout != desktop_layout_state(expected)
    {
        return Err(ThreatForgeError::LegacyLayoutUnavailable);
    }
    Ok(Some(snapshot))
}

fn desktop_layout_state(revision: &str) -> Option<&str> {
    revision.split_once(':').map(|(_, layout)| layout)
}

pub(crate) fn read_desktop_document(path: &Path) -> Result<DocumentSnapshot, ThreatForgeError> {
    let target = WriteTarget::from_path(path)?;
    let mut snapshot = target.read_document()?;
    let layouts = target.read_layouts(&snapshot.model);
    snapshot.revision = desktop_revision(&snapshot.revision, &layouts)?;
    layouts.merge_into(&mut snapshot.model);
    Ok(snapshot)
}

fn desktop_revision(content: &str, layouts: &LegacyLayouts) -> Result<String, ThreatForgeError> {
    if layouts.is_empty() {
        return Ok(content.to_owned());
    }
    let bytes = serde_json::to_vec(layouts).map_err(|source| ThreatForgeError::JsonParse {
        path: "diagram layout".into(),
        source,
    })?;
    let state = if layouts.has_unavailable() {
        "unavailable"
    } else {
        "loaded"
    };
    Ok(format!("{content}:{state}:{}", revision(&bytes)))
}

#[cfg(test)]
fn read_bytes(path: &Path) -> Result<Vec<u8>, ThreatForgeError> {
    fs::read(path).map_err(|source| ThreatForgeError::FileRead {
        path: path.display().to_string(),
        source,
    })
}

fn parse_document(path: &Path, bytes: &[u8]) -> Result<DocumentSnapshot, ThreatForgeError> {
    parse_document_with_revision(path, bytes, revision(bytes))
}

fn parse_document_with_revision(
    path: &Path,
    bytes: &[u8],
    revision: String,
) -> Result<DocumentSnapshot, ThreatForgeError> {
    let yaml_error = |source| ThreatForgeError::YamlParse {
        path: path.display().to_string(),
        source,
    };
    let raw: Value = serde_yaml::from_slice(bytes).map_err(yaml_error)?;
    let mut typed = raw.clone();
    if typed.get("version").and_then(Value::as_str) != Some("1.1") {
        if let Some(diagrams) = typed.get_mut("diagrams").and_then(Value::as_sequence_mut) {
            for diagram in diagrams.iter_mut().filter_map(Value::as_mapping_mut) {
                diagram.remove("sequence");
            }
        }
    }
    let model = serde_yaml::from_value(typed).map_err(yaml_error)?;
    validate_model(&model)?;
    Ok(DocumentSnapshot {
        model,
        revision,
        raw,
        bytes: bytes.to_vec(),
    })
}

fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn alias_free_yaml(bytes: &[u8]) -> bool {
    use std::mem::MaybeUninit;

    let mut parser = MaybeUninit::<unsafe_libyaml::yaml_parser_t>::uninit();
    let parser = parser.as_mut_ptr();
    // SAFETY: The parser stays at this address until deleted. The slice outlives
    // the parser, and every successfully parsed event is deleted before reuse.
    unsafe {
        if unsafe_libyaml::yaml_parser_initialize(parser).fail {
            return false;
        }
        unsafe_libyaml::yaml_parser_set_encoding(parser, unsafe_libyaml::YAML_UTF8_ENCODING);
        unsafe_libyaml::yaml_parser_set_input_string(parser, bytes.as_ptr(), bytes.len() as u64);
        let mut event = MaybeUninit::<unsafe_libyaml::yaml_event_t>::uninit();
        let event = event.as_mut_ptr();
        let alias_free = loop {
            if unsafe_libyaml::yaml_parser_parse(parser, event).fail {
                break false;
            }
            let kind = (*event).type_;
            unsafe_libyaml::yaml_event_delete(event);
            match kind {
                unsafe_libyaml::YAML_ALIAS_EVENT => break false,
                unsafe_libyaml::YAML_STREAM_END_EVENT => break true,
                _ => {}
            }
        };
        unsafe_libyaml::yaml_parser_delete(parser);
        alias_free
    }
}

#[cfg(test)]
pub(crate) fn commit_document(
    path: &Path,
    expected: Option<&str>,
    proposed: ThreatModel,
) -> Result<String, ThreatForgeError> {
    write_document(path, expected, proposed).map(|written| written.revision)
}

#[cfg(test)]
pub fn write_document(
    path: &Path,
    expected: Option<&str>,
    proposed: ThreatModel,
) -> Result<WrittenDocument, ThreatForgeError> {
    WriteTarget::from_path(path)?.write_document(expected, proposed)
}

pub(crate) fn write_desktop_document(
    path: &Path,
    expected: &str,
    proposed: ThreatModel,
) -> Result<WrittenDocument, ThreatForgeError> {
    write_with_base(
        &WriteTarget::from_path(path)?,
        Some(expected),
        proposed,
        Base::Desktop,
    )
}

pub(crate) fn verify_desktop_copy_source(
    path: &Path,
    expected: Option<&str>,
    source_yaml: Option<&str>,
) -> Result<(), ThreatForgeError> {
    if let Some(yaml) = source_yaml {
        let source = parse_document(path, yaml.as_bytes())?;
        if source
            .model
            .diagrams
            .iter()
            .any(|diagram| diagram.layout_file.is_some() && diagram.viewport.is_none())
        {
            let captured_layout = expected
                .and_then(desktop_layout_state)
                .is_some_and(|layout| layout.starts_with("loaded:"));
            if !captured_layout {
                return Err(ThreatForgeError::LegacyLayoutUnavailable);
            }
        }
    }
    Ok(())
}

pub fn copy_document(
    path: &Path,
    expected: Option<&str>,
    proposed: ThreatModel,
    source_yaml: Option<&str>,
) -> Result<WrittenDocument, ThreatForgeError> {
    WriteTarget::from_path(path)?.copy_document(expected, proposed, source_yaml)
}

enum Base<'a> {
    Destination(Option<&'a RemovedEntities>),
    Desktop,
    Source(Option<&'a str>),
}

#[derive(Default)]
pub(crate) struct RemovedEntities(HashMap<&'static str, HashSet<String>>);

impl RemovedEntities {
    pub(crate) fn record(&mut self, before: &ThreatModel, after: &ThreatModel) {
        macro_rules! record_sections {
            ($($section:ident),+ $(,)?) => {
                $(self.record_section(
                    stringify!($section),
                    before.$section.iter().map(|item| item.id.as_str()),
                    after.$section.iter().map(|item| item.id.as_str()),
                );)+
            };
        }
        record_sections!(
            layers,
            groups,
            elements,
            data_flows,
            relationships,
            trust_boundaries,
            threats,
            diagrams,
        );
    }

    fn record_section<'a>(
        &mut self,
        section: &'static str,
        before: impl Iterator<Item = &'a str> + Clone,
        after: impl Iterator<Item = &'a str> + Clone,
    ) {
        if before.clone().eq(after.clone()) {
            return;
        }
        let remaining: HashSet<_> = after.collect();
        for id in before.filter(|id| !remaining.contains(id)) {
            self.0.entry(section).or_default().insert(id.to_owned());
        }
    }

    fn exclude_from(&self, raw: &mut Value) {
        for (section, ids) in &self.0 {
            if let Some(items) = raw.get_mut(*section).and_then(Value::as_sequence_mut) {
                items.retain(|item| entity_id(item).is_none_or(|id| !ids.contains(id)));
            }
        }
    }
}

pub fn destination_revision(path: &Path) -> Result<Option<String>, ThreatForgeError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(revision(&bytes))),
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(ThreatForgeError::FileRead {
            path: path.display().to_string(),
            source,
        }),
    }
}

pub(crate) struct WriteRoot {
    path: PathBuf,
    dir: Dir,
}

impl WriteRoot {
    pub fn open(path: &Path) -> Result<Self, ThreatForgeError> {
        Dir::open_ambient_dir(path, ambient_authority())
            .map(|dir| Self {
                path: path.to_owned(),
                dir,
            })
            .map_err(|source| write_error(path, source))
    }

    pub fn is_current(&self) -> io::Result<bool> {
        if self.path.canonicalize()? != self.path {
            return Ok(false);
        }
        let held = self.dir.dir_metadata()?;
        let current = Dir::open_ambient_dir(&self.path, ambient_authority())?.dir_metadata()?;
        Ok((held.dev(), held.ino()) == (current.dev(), current.ino()))
    }

    pub fn target(&self, path: &Path) -> Result<WriteTarget, ThreatForgeError> {
        let relative = path
            .strip_prefix(&self.path)
            .map_err(|_| ThreatForgeError::UnapprovedPath)?;
        let parent = relative.parent().ok_or(ThreatForgeError::UnapprovedPath)?;
        let name = relative
            .file_name()
            .ok_or(ThreatForgeError::UnapprovedPath)?
            .to_owned();
        let mut dir = self
            .dir
            .try_clone()
            .map_err(|source| write_error(path, source))?;
        for part in parent.components() {
            let Component::Normal(name) = part else {
                return Err(ThreatForgeError::UnapprovedPath);
            };
            dir = dir
                .open_dir_nofollow(name)
                .map_err(|_| ThreatForgeError::UnapprovedPath)?;
        }
        let target = WriteTarget {
            dir,
            path: path.to_owned(),
            name,
        };
        target.metadata(target.name())?;
        Ok(target)
    }
}

pub(crate) struct WriteTarget {
    dir: Dir,
    path: PathBuf,
    name: OsString,
}

impl WriteTarget {
    pub(super) fn from_path(path: &Path) -> Result<Self, ThreatForgeError> {
        let path = resolve_target(path)?;
        let parent = path.parent().ok_or(ThreatForgeError::UnapprovedPath)?;
        WriteRoot::open(parent)?.target(&path)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn same_parent(&self, other: &Self) -> io::Result<bool> {
        let held = self.dir.dir_metadata()?;
        let current = other.dir.dir_metadata()?;
        Ok((held.dev(), held.ino()) == (current.dev(), current.ino()))
    }

    fn name(&self) -> &OsStr {
        &self.name
    }

    fn metadata(&self, name: &OsStr) -> Result<Option<cap_std::fs::Metadata>, ThreatForgeError> {
        match self.dir.symlink_metadata(name) {
            Ok(metadata) if metadata.is_file() => Ok(Some(metadata)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            _ => Err(ThreatForgeError::UnapprovedPath),
        }
    }

    fn read_bytes(&self) -> io::Result<Vec<u8>> {
        let mut file = self.dir.open_with(
            self.name(),
            OpenOptions::new().read(true).follow(FollowSymlinks::No),
        )?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    pub fn read_document(&self) -> Result<DocumentSnapshot, ThreatForgeError> {
        let bytes = self
            .read_bytes()
            .map_err(|source| ThreatForgeError::FileRead {
                path: self.path.display().to_string(),
                source,
            })?;
        parse_document(&self.path, &bytes)
    }

    pub(crate) fn read_layouts(&self, model: &ThreatModel) -> LegacyLayouts {
        let mut budget = MAX_LAYOUT_TOTAL_BYTES;
        LegacyLayouts::capture(model, |relative| self.read_sidecar(relative, &mut budget))
    }

    fn read_sidecar(
        &self,
        relative: &Path,
        budget: &mut u64,
    ) -> Option<crate::models::DiagramLayout> {
        let limit = MAX_LAYOUT_FILE_BYTES.min(*budget);
        if limit == 0 || relative.extension()?.to_str()? != "json" {
            return None;
        }
        let mut components = relative.components().peekable();
        let mut dir = self.dir.try_clone().ok()?;
        while let Some(part) = components.next() {
            let Component::Normal(name) = part else {
                return None;
            };
            if components.peek().is_some() {
                dir = dir.open_dir_nofollow(name).ok()?;
            } else if dir.symlink_metadata(name).ok()?.is_file() {
                let file = dir
                    .open_with(
                        name,
                        OpenOptions::new().read(true).follow(FollowSymlinks::No),
                    )
                    .ok()?;
                let metadata = file.metadata().ok()?;
                if !metadata.is_file() || metadata.len() > limit {
                    return None;
                }
                let mut bytes = Vec::new();
                let read = file.take(limit + 1).read_to_end(&mut bytes);
                *budget = budget.saturating_sub(bytes.len() as u64);
                if read.is_err() || bytes.len() as u64 != metadata.len() {
                    return None;
                }
                return serde_json::from_slice(&bytes).ok();
            }
        }
        None
    }

    pub(crate) fn read_document_for_search(
        &self,
        budget: &mut u64,
        max_file_bytes: u64,
    ) -> Option<DocumentSnapshot> {
        let limit = max_file_bytes.min(*budget);
        if limit == 0 {
            return None;
        }
        let file = self
            .dir
            .open_with(
                self.name(),
                OpenOptions::new().read(true).follow(FollowSymlinks::No),
            )
            .ok()?;
        let metadata = file.metadata().ok()?;
        if !metadata.is_file() || metadata.len() > limit {
            return None;
        }
        let mut bytes = Vec::new();
        let read = file.take(limit).read_to_end(&mut bytes);
        *budget -= bytes.len() as u64;
        if read.is_err() || bytes.len() as u64 != metadata.len() || !alias_free_yaml(&bytes) {
            return None;
        }
        parse_document(&self.path, &bytes).ok()
    }

    pub fn write_document(
        &self,
        expected: Option<&str>,
        proposed: ThreatModel,
    ) -> Result<WrittenDocument, ThreatForgeError> {
        write_with_base(self, expected, proposed, Base::Destination(None))
    }

    pub(crate) fn write_document_with_removals(
        &self,
        expected: &str,
        proposed: ThreatModel,
        removed: Option<&RemovedEntities>,
    ) -> Result<WrittenDocument, ThreatForgeError> {
        write_with_base(self, Some(expected), proposed, Base::Destination(removed))
    }

    pub fn copy_document(
        &self,
        expected: Option<&str>,
        proposed: ThreatModel,
        source_yaml: Option<&str>,
    ) -> Result<WrittenDocument, ThreatForgeError> {
        write_with_base(self, expected, proposed, Base::Source(source_yaml))
    }

    pub(crate) fn restore_document(
        &self,
        expected: &str,
        bytes: &[u8],
    ) -> Result<String, ThreatForgeError> {
        let _lock = self.lock_document()?;
        self.checked_destination(Some(expected), false)?;
        let snapshot = parse_document(self.path(), bytes)?;
        self.atomic_write(bytes)?;
        Ok(snapshot.revision)
    }

    fn lock_document(&self) -> Result<fs::File, ThreatForgeError> {
        let mut lock_name = self.name().to_os_string();
        lock_name.push(".lock");
        self.metadata(&lock_name)?;
        let lock = self
            .dir
            .open_with(
                &lock_name,
                OpenOptions::new()
                    .create(true)
                    .truncate(false)
                    .read(true)
                    .write(true)
                    .follow(FollowSymlinks::No),
            )
            .map_err(|source| write_error(self.path(), source))?
            .into_std();
        lock.lock()
            .map_err(|source| write_error(self.path(), source))?;
        Ok(lock)
    }

    fn checked_destination(
        &self,
        expected: Option<&str>,
        desktop: bool,
    ) -> Result<Option<Vec<u8>>, ThreatForgeError> {
        self.metadata(self.name())?;
        match self.read_bytes() {
            Ok(bytes) => {
                let content = revision(&bytes);
                let current = if desktop {
                    let snapshot = parse_document(self.path(), &bytes)?;
                    let layouts = self.read_layouts(&snapshot.model);
                    if layouts.has_unavailable() {
                        return Err(ThreatForgeError::LegacyLayoutUnavailable);
                    }
                    desktop_revision(&content, &layouts)?
                } else {
                    content
                };
                if expected == Some(current.as_str()) {
                    Ok(Some(bytes))
                } else {
                    Err(ThreatForgeError::DocumentConflict)
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound && expected.is_none() => Ok(None),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                Err(ThreatForgeError::DocumentConflict)
            }
            Err(source) => Err(write_error(self.path(), source)),
        }
    }

    pub fn atomic_write(&self, bytes: &[u8]) -> Result<(), ThreatForgeError> {
        self.atomic_write_checked(bytes, || Ok(()))
    }

    pub(crate) fn atomic_write_checked(
        &self,
        bytes: &[u8],
        check: impl Fn() -> Result<(), ThreatForgeError>,
    ) -> Result<(), ThreatForgeError> {
        check()?;
        let existing = self.metadata(self.name())?;
        let temporary_name = format!(".threatforge-{}.tmp", uuid::Uuid::new_v4());
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        cap_std::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = self
            .dir
            .open_with(&temporary_name, &options)
            .map_err(|source| write_error(&self.path, source))?;
        let written = (|| {
            if let Some(metadata) = existing {
                file.set_permissions(metadata.permissions())?;
            }
            file.write_all(bytes)?;
            file.sync_all()
        })();
        drop(file);
        let result = written
            .map_err(|source| write_error(&self.path, source))
            .and_then(|()| check())
            .and_then(|()| {
                self.dir
                    .rename(&temporary_name, &self.dir, self.name())
                    .map_err(|source| write_error(&self.path, source))
            });
        if result.is_err() {
            let _ = self.dir.remove_file(&temporary_name);
        }
        result
    }
}

fn write_with_base(
    target: &WriteTarget,
    expected: Option<&str>,
    mut proposed: ThreatModel,
    base: Base<'_>,
) -> Result<WrittenDocument, ThreatForgeError> {
    let path = target.path();
    let _lock = target.lock_document()?;
    let desktop = matches!(base, Base::Desktop);
    let destination = target.checked_destination(expected, desktop)?;
    let prior = match base {
        Base::Destination(_) | Base::Desktop => destination.as_deref(),
        Base::Source(source) => source.map(str::as_bytes),
    }
    .map(|bytes| parse_document(path, bytes))
    .transpose()?;
    if let Some(prior) = &prior {
        prior.validate_sequence_promotion(&proposed.version)?;
    }
    prepare_document(
        prior.as_ref().map(|snapshot| &snapshot.model),
        &mut proposed,
    )?;

    let mut value = model_value(&proposed)?;
    if let Some(mut prior) = prior {
        if let Base::Destination(Some(removed)) = base {
            removed.exclude_from(&mut prior.raw);
        }
        let known = model_value(&prior.model)?;
        preserve_unknown(&mut value, &known, &prior.raw);
    }
    let yaml = serde_yaml::to_string(&value)
        .map_err(|source| ThreatForgeError::YamlSerialize { source })?;
    let content = format!(
        "# ThreatForge Threat Model\n# Generated by ThreatForge v{}\n{yaml}",
        env!("CARGO_PKG_VERSION"),
    );
    let content_revision = revision(content.as_bytes());
    let revision = if desktop || matches!(base, Base::Source(_)) {
        desktop_revision(&content_revision, &target.read_layouts(&proposed))?
    } else {
        content_revision
    };
    if desktop {
        target.atomic_write_checked(content.as_bytes(), || {
            target.checked_destination(expected, true)?;
            Ok(())
        })?;
    } else {
        target.atomic_write(content.as_bytes())?;
    }
    Ok(WrittenDocument {
        revision,
        yaml: content,
    })
}

fn model_value(model: &ThreatModel) -> Result<Value, ThreatForgeError> {
    serde_yaml::to_value(model).map_err(|source| ThreatForgeError::YamlSerialize { source })
}

pub(crate) fn prepare_document(
    prior: Option<&ThreatModel>,
    proposed: &mut ThreatModel,
) -> Result<(), ThreatForgeError> {
    if let Some(prior) = prior {
        cascade_removed_references(prior, proposed);
    }
    validate_model(proposed)
}

impl DocumentSnapshot {
    pub(crate) fn validate_sequence_promotion(
        &self,
        version: &str,
    ) -> Result<(), ThreatForgeError> {
        if self.model.version == "1.0"
            && version == "1.1"
            && self
                .raw
                .get("diagrams")
                .and_then(Value::as_sequence)
                .is_some_and(|diagrams| {
                    diagrams
                        .iter()
                        .any(|diagram| diagram.get("sequence").is_some())
                })
        {
            return Err(ThreatForgeError::SequencePromotionConflict);
        }
        Ok(())
    }

    pub fn source_yaml(&self) -> Result<String, ThreatForgeError> {
        serde_yaml::to_string(&self.raw)
            .map_err(|source| ThreatForgeError::YamlSerialize { source })
    }

    pub fn preserved_model(&self) -> Result<Value, ThreatForgeError> {
        let known = model_value(&self.model)?;
        let mut value = known.clone();
        preserve_unknown(&mut value, &known, &self.raw);
        Ok(value)
    }
}

fn preserve_unknown(next: &mut Value, known: &Value, raw: &Value) {
    match (next, known, raw) {
        (Value::Mapping(next), Value::Mapping(known), Value::Mapping(raw)) => {
            for (key, raw_value) in raw {
                if let Some(known_value) = known.get(key) {
                    if let Some(next_value) = next.get_mut(key) {
                        preserve_unknown(next_value, known_value, raw_value);
                    }
                } else if !next.contains_key(key) {
                    next.insert(key.clone(), raw_value.clone());
                }
            }
        }
        (Value::Sequence(next), Value::Sequence(known), Value::Sequence(raw)) => {
            let known = entities_by_id(known);
            let raw = entities_by_id(raw);
            for entry in next {
                if let Some((known, raw)) =
                    entity_id(entry).and_then(|id| known.get(id).zip(raw.get(id)))
                {
                    preserve_unknown(entry, known, raw);
                }
            }
        }
        _ => {}
    }
}

fn entity_id(value: &Value) -> Option<&str> {
    value
        .as_mapping()
        .and_then(|map: &Mapping| map.get("id"))?
        .as_str()
}

fn entities_by_id(entries: &[Value]) -> HashMap<&str, &Value> {
    entries
        .iter()
        .filter_map(|entry| Some((entity_id(entry)?, entry)))
        .collect()
}

fn cascade_removed_references(prior: &ThreatModel, next: &mut ThreatModel) {
    let elements: HashSet<&str> = next.elements.iter().map(|item| item.id.as_str()).collect();
    let removed: HashSet<&str> = prior
        .elements
        .iter()
        .map(|item| item.id.as_str())
        .filter(|id| !elements.contains(id))
        .collect();
    next.data_flows.retain(|item| {
        !removed.contains(item.from.as_str()) && !removed.contains(item.to.as_str())
    });
    next.relationships.retain(|item| {
        !removed.contains(item.from.as_str()) && !removed.contains(item.to.as_str())
    });
    for boundary in &mut next.trust_boundaries {
        boundary
            .contains
            .retain(|id| !removed.contains(id.as_str()));
    }
    let flows: HashSet<&str> = next
        .data_flows
        .iter()
        .map(|item| item.id.as_str())
        .collect();
    let removed_flows: HashSet<&str> = prior
        .data_flows
        .iter()
        .map(|item| item.id.as_str())
        .filter(|id| !flows.contains(id))
        .collect();
    next.threats.retain(|item| {
        !item
            .element
            .as_deref()
            .is_some_and(|id| removed.contains(id))
            && !item
                .flow
                .as_deref()
                .is_some_and(|id| removed_flows.contains(id))
    });
}

pub fn resolve_target(path: &Path) -> Result<PathBuf, ThreatForgeError> {
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return Err(ThreatForgeError::UnapprovedPath);
    }
    let parent = path.parent().ok_or(ThreatForgeError::UnapprovedPath)?;
    let name = path.file_name().ok_or(ThreatForgeError::UnapprovedPath)?;
    let target = parent
        .canonicalize()
        .map_err(|_| ThreatForgeError::UnapprovedPath)?
        .join(name);
    match fs::symlink_metadata(&target) {
        Ok(metadata) if !metadata.is_file() => Err(ThreatForgeError::UnapprovedPath),
        Ok(_) => Ok(target),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(target),
        Err(_) => Err(ThreatForgeError::UnapprovedPath),
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), ThreatForgeError> {
    let parent = path.parent().ok_or(ThreatForgeError::UnapprovedPath)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|err| write_error(path, err))?;
    if let Ok(metadata) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(metadata.permissions())
            .map_err(|err| write_error(path, err))?;
    }
    temp.write_all(bytes)
        .map_err(|err| write_error(path, err))?;
    temp.as_file()
        .sync_all()
        .map_err(|err| write_error(path, err))?;
    temp.persist(path)
        .map_err(|err| write_error(path, err.error))?;
    Ok(())
}

fn write_error(path: &Path, source: io::Error) -> ThreatForgeError {
    ThreatForgeError::FileWrite {
        path: path.display().to_string(),
        source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_id_threat_replacement_does_not_inherit_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.thf");
        let mut raw: Value = serde_yaml::from_str(include_str!(
            "../../../tests/fixtures/thf/architecture-canonical-full.thf"
        ))
        .unwrap();
        raw["threats"][0]["future"] = Value::String("deleted".into());
        fs::write(&path, serde_yaml::to_string(&raw).unwrap()).unwrap();
        let snapshot = read_document(&path).unwrap();
        let mut proposed = snapshot.model.clone();
        let mut replacement = proposed.threats.remove(0);
        let mut removed = RemovedEntities::default();
        removed.record(&snapshot.model, &proposed);
        replacement.title = "Replacement threat".into();
        proposed.threats.push(replacement);
        WriteTarget::from_path(&path)
            .unwrap()
            .write_document_with_removals(&snapshot.revision, proposed, Some(&removed))
            .unwrap();
        let saved = read_document(&path).unwrap();
        assert_eq!(saved.raw["threats"][0]["id"], raw["threats"][0]["id"]);
        assert_eq!(saved.raw["threats"][0]["title"], "Replacement threat");
        assert!(saved.raw["threats"][0].get("future").is_none());
    }

    #[test]
    fn competing_transactions_from_the_same_revision_cannot_both_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.thf");
        let revision = commit_document(&path, None, ThreatModel::new("One", "Author")).unwrap();
        let gate = std::sync::Barrier::new(2);
        let (a, b) = std::thread::scope(|scope| {
            let save = |title| {
                gate.wait();
                commit_document(&path, Some(&revision), ThreatModel::new(title, "Author"))
            };
            let a = scope.spawn(move || save("Two"));
            let b = scope.spawn(move || save("Three"));
            (a.join().unwrap(), b.join().unwrap())
        });
        assert!(matches!(
            (&a, &b),
            (Ok(_), Err(ThreatForgeError::DocumentConflict))
                | (Err(ThreatForgeError::DocumentConflict), Ok(_))
        ));
        let saved = read_document(&path).unwrap();
        assert_eq!(saved.revision, a.or(b).unwrap());
        assert_ne!(saved.revision, revision);
    }

    #[test]
    fn cascading_save_preserves_unknown_fields_but_not_deleted_entities() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.thf");
        let mut raw: Value = serde_yaml::from_str(include_str!(
            "../../../tests/fixtures/thf/architecture-canonical-full.thf"
        ))
        .unwrap();
        let deleted_id = raw["elements"][1]["id"].as_str().unwrap().to_owned();
        raw["elements"][1]["future"] = Value::String("deleted".into());
        let surviving_id = raw["elements"][0]["id"].as_str().unwrap().to_owned();
        raw["elements"][0]["future"] = Value::String("preserved".into());
        raw["metadata"]["future"] = Value::Bool(true);
        raw["future"] = Value::Bool(true);
        fs::write(&path, serde_yaml::to_string(&raw).unwrap()).unwrap();
        let mut snapshot = read_document(&path).unwrap();
        snapshot.model.elements.remove(1);
        snapshot.model.elements.reverse();
        commit_document(&path, Some(&snapshot.revision), snapshot.model).unwrap();
        let saved = read_document(&path).unwrap();
        assert_eq!(saved.raw["future"], Value::Bool(true));
        assert_eq!(saved.raw["metadata"]["future"], Value::Bool(true));
        assert_eq!(
            entities_by_id(saved.raw["elements"].as_sequence().unwrap())[surviving_id.as_str()]
                ["future"],
            "preserved"
        );
        assert!(saved.model.data_flows.is_empty());
        assert_eq!(saved.model.relationships.len(), 1);
        assert_eq!(saved.model.relationships[0].id, "rel-2");
        assert!(saved.model.threats.is_empty());
        assert!(!saved
            .model
            .trust_boundaries
            .iter()
            .any(|b| b.contains.contains(&deleted_id)));
    }

    #[test]
    fn failed_validation_does_not_replace_the_document() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.thf");
        let revision = commit_document(&path, None, ThreatModel::new("Valid", "Author")).unwrap();
        let mut model = ThreatModel::new("Invalid", "Author");
        model.version = "2.0".into();
        assert!(matches!(
            commit_document(&path, Some(&revision), model),
            Err(ThreatForgeError::UnsupportedVersion { .. })
        ));
        assert_eq!(read_document(&path).unwrap().revision, revision);
    }

    #[test]
    fn save_as_copies_only_source_unknown_fields_to_new_and_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.thf");
        let original = model_value(&ThreatModel::new("Source", "Author")).unwrap();
        let mut raw = original.clone();
        let complex_key = Value::Sequence(vec![Value::String("key".into())]);
        raw["future"] = Value::Mapping(Mapping::from_iter([(
            complex_key,
            Value::String("source".into()),
        )]));
        fs::write(&source, serde_yaml::to_string(&raw).unwrap()).unwrap();
        let snapshot = read_document(&source).unwrap();
        let source_yaml = snapshot.source_yaml().unwrap();
        fs::remove_file(&source).unwrap();

        let existing = dir.path().join("existing.thf");
        let mut destination = original;
        destination["future"] = Value::String("destination".into());
        destination["destination_only"] = Value::Bool(true);
        fs::write(&existing, serde_yaml::to_string(&destination).unwrap()).unwrap();
        for path in [dir.path().join("new.thf"), existing] {
            let expected = destination_revision(&path).unwrap();
            let mut proposed = snapshot.model.clone();
            proposed.metadata.title = "Edited source".into();
            let written =
                copy_document(&path, expected.as_deref(), proposed, Some(&source_yaml)).unwrap();
            let saved = read_document(&path).unwrap();
            assert_eq!(saved.model.metadata.title, "Edited source");
            assert_eq!(saved.raw["future"], raw["future"]);
            assert!(saved.raw.get("destination_only").is_none());
            assert_eq!(saved.revision, written.revision);
        }
    }

    #[test]
    fn save_as_refuses_a_changed_destination_even_with_a_valid_source() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("destination.thf");
        let source = ThreatModel::new("Source", "Author");
        let source_yaml = serde_yaml::to_string(&source).unwrap();
        let picked = commit_document(
            &destination,
            None,
            ThreatModel::new("Picked destination", "Author"),
        )
        .unwrap();
        let revision = commit_document(
            &destination,
            Some(&picked),
            ThreatModel::new("Concurrent edit", "Author"),
        )
        .unwrap();
        assert!(matches!(
            copy_document(&destination, Some(&picked), source, Some(&source_yaml)),
            Err(ThreatForgeError::DocumentConflict)
        ));
        assert_eq!(read_document(&destination).unwrap().revision, revision);
    }

    #[test]
    fn sidecar_paths_cannot_escape_the_model_directory() {
        let dir = tempfile::tempdir().unwrap();
        let target = WriteTarget::from_path(&dir.path().join("model.thf")).unwrap();
        let mut budget = MAX_LAYOUT_TOTAL_BYTES;
        assert!(target
            .read_sidecar(Path::new("../private.json"), &mut budget)
            .is_none());
        assert!(target
            .read_sidecar(&dir.path().join("private.json"), &mut budget)
            .is_none());
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
            assert!(target
                .read_sidecar(Path::new("link/private.json"), &mut budget)
                .is_none());
        }
    }

    #[test]
    fn search_rejects_aliases_but_not_literal_asterisks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.thf");
        let yaml = include_str!("../../../tests/fixtures/thf/legacy-sidecar/model.thf");
        let target = WriteTarget::from_path(&path).unwrap();
        std::fs::write(&path, format!("{yaml}\nextra: '*literal'\n")).unwrap();
        assert!(target.read_document_for_search(&mut 4096, 4096).is_some());
        std::fs::write(&path, format!("{yaml}\nextra: &name value\ncopy: *name\n")).unwrap();
        assert!(target.read_document().is_ok());
        assert!(target.read_document_for_search(&mut 4096, 4096).is_none());
    }
}
