use crate::file_io::{WriteRoot, WriteTarget};
use std::fs;
use std::path::{Component, Path, PathBuf};

const MAX_ENTRIES: usize = 10_000;
pub(super) const MAX_RESULTS: usize = 200;

pub(super) struct Workspace {
    root: PathBuf,
    writes: WriteRoot,
}

impl Workspace {
    pub fn new(root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|_| "Could not resolve the workspace root.")?;
        if !root.is_dir() {
            return Err("The workspace root must be a directory.".into());
        }
        let writes = WriteRoot::open(&root).map_err(|error| error.user_message())?;
        Ok(Self { root, writes })
    }

    pub fn write_target(&self, path: &Path) -> Result<WriteTarget, String> {
        self.ensure_current()?;
        self.writes
            .target(path)
            .map_err(|error| error.user_message())
    }

    pub fn ensure_current(&self) -> Result<(), String> {
        match self.writes.is_current() {
            Ok(true) => Ok(()),
            _ => Err("The workspace root has moved. Restart the MCP server to reopen it.".into()),
        }
    }

    pub fn resolve(&self, relative: &Path, extension: &str) -> Result<PathBuf, String> {
        if relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
            || relative.extension().and_then(|ext| ext.to_str()) != Some(extension)
        {
            return Err(format!("Provide a workspace-relative .{extension} path."));
        }
        let requested = self.root.join(relative);
        self.write_target(&requested)?;
        Ok(requested)
    }

    pub fn relative(&self, path: &Path) -> Result<String, String> {
        let relative = path
            .strip_prefix(&self.root)
            .map_err(|_| "The file is outside the workspace.")?;
        Ok(relative
            .iter()
            .map(|part| part.to_str().ok_or("Workspace paths must be valid UTF-8."))
            .collect::<Result<Vec<_>, _>>()?
            .join("/"))
    }

    pub fn documents(&self) -> Result<Vec<PathBuf>, String> {
        self.ensure_current()?;
        let mut paths = Vec::new();
        let mut folders = vec![self.root.clone()];
        let mut visited = 0;
        while let Some(folder) = folders.pop() {
            if folder.canonicalize().ok().as_ref() != Some(&folder) {
                return Err("A workspace folder has moved.".into());
            }
            let entries = fs::read_dir(folder).map_err(|_| "Could not list the workspace.")?;
            for entry in entries {
                visited += 1;
                if visited > MAX_ENTRIES {
                    return Err(
                        "The workspace is too large to scan; choose a narrower root.".into(),
                    );
                }
                let entry = entry.map_err(|_| "Could not read a workspace entry.")?;
                let kind = entry
                    .file_type()
                    .map_err(|_| "Could not inspect a workspace entry.")?;
                let path = entry.path();
                if kind.is_dir() {
                    if !entry.file_name().to_string_lossy().starts_with('.') {
                        folders.push(path);
                    }
                } else if kind.is_file()
                    && path.extension().and_then(|ext| ext.to_str()) == Some("thf")
                    && self.relative(&path).is_ok()
                {
                    paths.push(path);
                }
            }
        }
        self.ensure_current()?;
        paths.sort_unstable();
        Ok(paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn writes_use_the_opened_directory_when_its_former_path_changes() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let folder = root.path().join("diagrams");
        let original = root.path().join("original");
        fs::create_dir(&folder).unwrap();
        let workspace = Workspace::new(root.path()).unwrap();
        let document = workspace
            .resolve(Path::new("diagrams/model.thf"), "thf")
            .unwrap();
        let exported = workspace
            .resolve(Path::new("diagrams/model.svg"), "svg")
            .unwrap();
        let write_document = workspace.write_target(&document).unwrap();
        let write_export = workspace.write_target(&exported).unwrap();

        fs::rename(&folder, &original).unwrap();
        std::os::unix::fs::symlink(outside.path(), &folder).unwrap();

        assert!(workspace.write_target(&document).is_err());
        write_document
            .write_document(None, crate::models::ThreatModel::new("Fixture", ""))
            .unwrap();
        write_export.atomic_write(b"<svg/>").unwrap();
        assert!(original.join("model.thf").is_file());
        assert!(original.join("model.thf.lock").is_file());
        assert_eq!(fs::read(original.join("model.svg")).unwrap(), b"<svg/>");
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[test]
    fn paths_must_stay_under_the_root_and_have_the_requested_extension() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(dir.path()).unwrap();
        assert!(workspace.resolve(Path::new("model.thf"), "thf").is_ok());
        assert!(workspace.resolve(Path::new("../model.thf"), "thf").is_err());
        assert!(workspace.resolve(Path::new("model.png"), "thf").is_err());
        assert!(workspace
            .resolve(&dir.path().join("model.thf"), "thf")
            .is_err());
        #[cfg(unix)]
        {
            let external = tempfile::tempdir().unwrap();
            fs::write(external.path().join("private.thf"), "private").unwrap();
            std::os::unix::fs::symlink(external.path(), dir.path().join("external")).unwrap();
            assert!(workspace
                .resolve(Path::new("external/private.thf"), "thf")
                .is_err());
            assert!(workspace.documents().unwrap().is_empty());
        }
    }
}
