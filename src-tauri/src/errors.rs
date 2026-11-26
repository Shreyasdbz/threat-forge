use thiserror::Error;

/// Application-level errors for ThreatForge
#[derive(Debug, Error)]
pub enum ThreatForgeError {
    #[error("The document changed on disk. Reopen it before saving, or save to a new file.")]
    DocumentConflict,

    #[error("The legacy layout could not be loaded safely. Restore the layout file before saving this diagram.")]
    LegacyLayoutUnavailable,

    #[error("The selected file is outside the approved location.")]
    UnapprovedPath,

    #[error("Failed to read file '{path}': {source}")]
    FileRead {
        path: String,
        source: std::io::Error,
    },

    #[error("Failed to write file '{path}': {source}")]
    FileWrite {
        path: String,
        source: std::io::Error,
    },

    #[error("Failed to parse YAML in '{path}': {source}")]
    YamlParse {
        path: String,
        source: serde_yaml::Error,
    },

    #[error("Failed to serialize YAML: {source}")]
    YamlSerialize { source: serde_yaml::Error },

    #[error("Failed to parse JSON in '{path}': {source}")]
    JsonParse {
        path: String,
        source: serde_json::Error,
    },

    #[error("Unsupported schema version '{version}'. Supported versions: {supported:?}")]
    UnsupportedVersion {
        version: String,
        supported: Vec<String>,
    },

    #[error("Duplicate ID '{id}' in section '{section}'")]
    DuplicateId { id: String, section: String },

    #[error("Invalid reference in '{field}': '{reference}' not found. Valid IDs: {valid:?}")]
    InvalidReference {
        field: String,
        reference: String,
        valid: Vec<String>,
    },

    #[error("Invalid sequence field '{field}': {reason}.")]
    InvalidSequence { field: String, reason: &'static str },

    #[error("Cannot create a typed sequence view: this 1.0 document already contains the opaque diagrams[].sequence field.")]
    SequencePromotionConflict,

    #[error("Circular group nesting detected at group '{id}'")]
    CircularGroupNesting { id: String },

    #[error("Key storage error: {message}")]
    KeyStorage { message: String },

    /// No credential is stored for a provider. Separate from
    /// [`ThreatForgeError::KeyStorage`] because it is the one key-storage
    /// failure a user can act on, and a caller at the IPC boundary has to tell
    /// it apart from a genuine storage fault to say so. Neither `Display` is
    /// user-safe: both name internal state, so the boundary authors its own
    /// sentence.
    #[error("No API key stored for provider '{provider}'")]
    NoApiKey { provider: String },
}

impl ThreatForgeError {
    pub fn user_message(&self) -> String {
        match self {
            Self::FileRead { .. } => "Could not read the selected file.".into(),
            Self::FileWrite { .. } => "Could not save the selected file.".into(),
            Self::YamlParse { .. } => {
                "The selected file is not a valid ThreatForge document.".into()
            }
            Self::JsonParse { .. } => "The layout file is invalid.".into(),
            Self::YamlSerialize { .. } => "Could not serialize the document.".into(),
            _ => self.to_string(),
        }
    }
}
