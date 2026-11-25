use super::reader::validate_model;
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

pub fn read_document(path: &Path) -> Result<DocumentSnapshot, ThreatForgeError> {
    parse_document(path, &read_bytes(path)?)
}

pub(crate) fn read_document_if_changed(
    path: &Path,
    expected: &str,
) -> Result<Option<DocumentSnapshot>, ThreatForgeError> {
    let bytes = read_bytes(path)?;
    let current = revision(&bytes);
    if current == expected {
        return Ok(None);
    }
    parse_document_with_revision(path, &bytes, current).map(Some)
}

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
    let model = serde_yaml::from_value(raw.clone()).map_err(yaml_error)?;
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

#[cfg(test)]
pub(crate) fn commit_document(
    path: &Path,
    expected: Option<&str>,
    proposed: ThreatModel,
) -> Result<String, ThreatForgeError> {
    write_document(path, expected, proposed).map(|written| written.revision)
}

pub fn write_document(
    path: &Path,
    expected: Option<&str>,
    proposed: ThreatModel,
) -> Result<WrittenDocument, ThreatForgeError> {
    WriteTarget::from_path(path)?.write_document(expected, proposed)
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
    Destination,
    Source(Option<&'a str>),
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
    fn from_path(path: &Path) -> Result<Self, ThreatForgeError> {
        let path = resolve_target(path)?;
        let parent = path.parent().ok_or(ThreatForgeError::UnapprovedPath)?;
        WriteRoot::open(parent)?.target(&path)
    }

    pub fn path(&self) -> &Path {
        &self.path
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
        if read.is_err() || bytes.len() as u64 != metadata.len() {
            return None;
        }
        parse_document(&self.path, &bytes).ok()
    }

    pub fn write_document(
        &self,
        expected: Option<&str>,
        proposed: ThreatModel,
    ) -> Result<WrittenDocument, ThreatForgeError> {
        write_with_base(self, expected, proposed, Base::Destination)
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
        self.checked_destination(Some(expected))?;
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
    ) -> Result<Option<Vec<u8>>, ThreatForgeError> {
        self.metadata(self.name())?;
        match self.read_bytes() {
            Ok(bytes) if expected == Some(revision(&bytes).as_str()) => Ok(Some(bytes)),
            Err(e) if e.kind() == io::ErrorKind::NotFound && expected.is_none() => Ok(None),
            Ok(_) => Err(ThreatForgeError::DocumentConflict),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                Err(ThreatForgeError::DocumentConflict)
            }
            Err(source) => Err(write_error(self.path(), source)),
        }
    }

    pub fn atomic_write(&self, bytes: &[u8]) -> Result<(), ThreatForgeError> {
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
        let result =
            written.and_then(|()| self.dir.rename(&temporary_name, &self.dir, self.name()));
        if result.is_err() {
            let _ = self.dir.remove_file(&temporary_name);
        }
        result.map_err(|source| write_error(&self.path, source))
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
    let destination = target.checked_destination(expected)?;
    let prior = match base {
        Base::Destination => destination.as_deref(),
        Base::Source(source) => source.map(str::as_bytes),
    }
    .map(|bytes| parse_document(path, bytes))
    .transpose()?;
    prepare_document(
        prior.as_ref().map(|snapshot| &snapshot.model),
        &mut proposed,
    )?;

    let mut value = model_value(&proposed)?;
    if let Some(prior) = prior {
        let known = model_value(&prior.model)?;
        preserve_unknown(&mut value, &known, &prior.raw);
    }
    let yaml = serde_yaml::to_string(&value)
        .map_err(|source| ThreatForgeError::YamlSerialize { source })?;
    let content = format!(
        "# ThreatForge Threat Model\n# Generated by ThreatForge v{}\n{yaml}",
        env!("CARGO_PKG_VERSION"),
    );
    target.atomic_write(content.as_bytes())?;
    Ok(WrittenDocument {
        revision: revision(content.as_bytes()),
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

pub fn resolve_sidecar(root: &Path, relative: &Path) -> Result<PathBuf, ThreatForgeError> {
    if relative
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
        || relative.extension().and_then(|ext| ext.to_str()) != Some("json")
    {
        return Err(ThreatForgeError::UnapprovedPath);
    }
    let root = root
        .canonicalize()
        .map_err(|_| ThreatForgeError::UnapprovedPath)?;
    let path = resolve_target(&root.join(relative))?;
    if !path.starts_with(root) {
        return Err(ThreatForgeError::UnapprovedPath);
    }
    Ok(path)
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
        assert!(resolve_sidecar(dir.path(), Path::new("../private.json")).is_err());
        assert!(resolve_sidecar(dir.path(), &dir.path().join("private.json")).is_err());
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
            assert!(resolve_sidecar(dir.path(), Path::new("link/private.json")).is_err());
        }
    }
}
