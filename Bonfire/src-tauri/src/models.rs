use serde::{Deserialize, Serialize};

/// Core entity: a "shard" — a code snippet with study metadata.
/// Field names are camelCase on the JS side; `rename_all` bridges that to
/// snake_case Rust fields. `#[serde(default)]` lets partial JSON (e.g. older
/// exports) deserialize without every key present.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Shard {
    pub id: String,
    pub title: String,
    pub language: String,
    /// The question/task shown during a test (optional; falls back to title).
    pub prompt: String,
    pub code: String,
    pub description: String,
    /// Which deck this card belongs to (empty => migrated to the default deck).
    pub deck_id: String,
    pub tags: Vec<String>,
    pub category: String,
    pub familiarity: String,
    pub source: String,
    pub related_ids: Vec<String>,
    pub created_at: String,
    pub modified_at: String,
    /// ISO-8601 timestamp; empty string means "never reviewed".
    pub last_reviewed: String,
    pub review_enabled: bool,
    pub review_interval: i64,
    pub review_repetitions: i64,
    pub review_ease: f64,
    /// "YYYY-MM-DD" of the next scheduled review (empty until enabled).
    pub review_next: String,
}

impl Default for Shard {
    fn default() -> Self {
        Shard {
            id: String::new(),
            title: String::new(),
            language: String::new(),
            prompt: String::new(),
            code: String::new(),
            description: String::new(),
            deck_id: String::new(),
            tags: Vec::new(),
            category: "snippet".to_string(),
            familiarity: "fresh".to_string(),
            source: String::new(),
            related_ids: Vec::new(),
            created_at: String::new(),
            modified_at: String::new(),
            last_reviewed: String::new(),
            review_enabled: false,
            review_interval: 0,
            review_repetitions: 0,
            review_ease: 2.5,
            review_next: String::new(),
        }
    }
}

/// A deck groups cards by subject. Its `preset` drives the frontend's field
/// labels / syntax-highlighting behaviour (see SUBJECT_PRESETS in constants.js).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Deck {
    pub id: String,
    pub name: String,
    /// One of the preset keys (e.g. "code", "prose", "vocab").
    pub preset: String,
    /// Sort order in the deck switcher.
    pub position: i64,
    pub created_at: String,
    pub modified_at: String,
}

impl Default for Deck {
    fn default() -> Self {
        Deck {
            id: String::new(),
            name: String::new(),
            preset: "code".to_string(),
            position: 0,
            created_at: String::new(),
            modified_at: String::new(),
        }
    }
}

/// Shape of the JSON export file: all shards, decks, and the user's custom languages.
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultExport {
    pub shards: Vec<Shard>,
    pub custom_languages: Vec<String>,
    pub decks: Vec<Deck>,
}
