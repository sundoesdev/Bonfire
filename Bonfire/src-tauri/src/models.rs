use serde::{Deserialize, Serialize};

/// An inline media attachment on a card (image or audio), stored as a base64
/// data-URL so the whole vault stays in a single JSON export with no asset
/// folder. `side` controls whether it shows with the question or the answer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaItem {
    pub id: String,
    /// "image" or "audio".
    pub kind: String,
    /// `data:<mime>;base64,...`
    pub data_url: String,
    pub caption: String,
    /// "question" (shown with the prompt) or "answer" (shown on reveal).
    pub side: String,
}

impl Default for MediaItem {
    fn default() -> Self {
        MediaItem {
            id: String::new(),
            kind: "image".to_string(),
            data_url: String::new(),
            caption: String::new(),
            side: "question".to_string(),
        }
    }
}

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
    /// Legacy single-deck field, kept as a mirror of the first membership for
    /// back-compat with older JSON exports. The source of truth is `deck_ids`.
    pub deck_id: String,
    /// Every deck this card belongs to (many-to-many). A card may be in several
    /// decks, or none ("deckless", surfaced by the integrity scanner).
    pub deck_ids: Vec<String>,
    /// Study format: "basic" (type the answer), "cloze" ({{c1::..}} blanks),
    /// or "reverse" (answer is shown, recall the title). Empty => "basic".
    pub card_type: String,
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
    /// FSRS memory stability (days). 0 until the card's first FSRS review.
    pub fsrs_stability: f64,
    /// FSRS difficulty, 1..=10. 0 until the card's first FSRS review.
    pub fsrs_difficulty: f64,
    /// FSRS learning state: "new" / "learning" / "review" / "relearning".
    pub fsrs_state: String,
    /// Number of times the card has been forgotten (lapsed).
    pub lapses: i64,
    /// Inline image/audio attachments.
    pub media: Vec<MediaItem>,
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
            deck_ids: Vec::new(),
            card_type: "basic".to_string(),
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
            fsrs_stability: 0.0,
            fsrs_difficulty: 0.0,
            fsrs_state: "new".to_string(),
            lapses: 0,
            media: Vec::new(),
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

/// A playbook: a self-authored, step-by-step tutorial over existing cards. It is a
/// tree of nodes (see `PlaybookNode`), each *referencing* a card — never a study
/// container. Cards stay in the library; a playbook only orders them for a walkthrough.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Playbook {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Sort order in the Playbooks list.
    pub position: i64,
    pub created_at: String,
    pub modified_at: String,
}

/// One node in a playbook's tree. `parent_id` empty = a root node; `position` orders
/// siblings (the a, b, c order). `card_id` references a shard — it never owns it.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaybookNode {
    pub id: String,
    pub playbook_id: String,
    pub card_id: String,
    pub parent_id: String,
    pub position: i64,
}

/// A playbook plus its full node list, returned together for the runner/editor.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaybookDetail {
    pub playbook: Playbook,
    pub nodes: Vec<PlaybookNode>,
}

/// One recorded review event, used for the study heatmap / streak analytics.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ReviewLogEntry {
    pub shard_id: String,
    pub deck_id: String,
    /// "YYYY-MM-DD" (local) — the day bucket for the heatmap.
    pub day: String,
    /// Full RFC-3339 timestamp.
    pub ts: String,
    pub rating: String,
    pub algorithm: String,
    /// Milliseconds spent on the card before grading (0 if not recorded).
    pub duration_ms: i64,
    /// Id of the study session this review belonged to (for per-day session counts).
    pub session_id: String,
}

/// A day's review count, returned to the frontend for the heatmap.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DayCount {
    pub day: String,
    pub count: i64,
}

/// Per-deck review count within a day (for the heatmap tooltip).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DeckCount {
    pub deck_id: String,
    pub count: i64,
}

/// Rich per-day study detail for the heatmap hover tooltip (item 8).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DayDetail {
    pub day: String,
    pub count: i64,
    pub duration_ms: i64,
    /// Number of distinct study sessions that day.
    pub sessions: i64,
    pub deck_counts: Vec<DeckCount>,
}

/// Shape of the JSON export file: all shards, decks, custom languages, and the
/// review history (so the heatmap/streak data survives a backup round-trip).
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultExport {
    pub shards: Vec<Shard>,
    pub custom_languages: Vec<String>,
    pub decks: Vec<Deck>,
    pub review_log: Vec<ReviewLogEntry>,
    pub playbooks: Vec<Playbook>,
    pub playbook_nodes: Vec<PlaybookNode>,
}
