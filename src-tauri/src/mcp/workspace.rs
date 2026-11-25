use crate::file_io::resolve_target;
use std::fs;
use std::path::{Component, Path, PathBuf};

const MAX_ENTRIES: usize = 10_000;
pub(super) const MAX_RESULTS: usize = 200;

pub(super) struct Workspace {
    root: PathBuf,
}

impl Workspace {
    pub fn new(root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|_| "Could not resolve the workspace root.")?;
        if !root.is_dir() {
            return Err("The workspace root must be a directory.".into());
        }
        Ok(Self { root })
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
        let path = resolve_target(&requested).map_err(|error| error.user_message())?;
        if path != requested {
            return Err("Symbolic links are not supported in workspace paths.".into());
        }
        Ok(path)
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
        paths.sort_unstable();
        Ok(paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
