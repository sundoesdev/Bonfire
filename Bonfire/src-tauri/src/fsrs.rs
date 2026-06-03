use chrono::{Duration, Local};

/// FSRS-4.5 spaced-repetition scheduler.
///
/// A faithful port of the open-source FSRS-4.5 algorithm: a memory model with
/// per-card *stability* (how long the memory lasts) and *difficulty* (1..=10).
/// Grades are 1=Again, 2=Hard, 3=Good, 4=Easy (see [`grade_from_rating`]).
/// Pure math, no dependencies — mirrors the shape of [`crate::sm2`].

/// Number of FSRS-4.5 weights.
pub const W_LEN: usize = 17;

/// Default FSRS-4.5 weight vector (the published defaults).
pub const DEFAULT_WEIGHTS: [f64; W_LEN] = [
    0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824,
    1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466,
];

/// Tunable FSRS parameters (see the "Spaced repetition" settings section).
pub struct FsrsConfig {
    pub weights: [f64; W_LEN],
    /// Target probability of recall at the scheduled time (e.g. 0.9).
    pub request_retention: f64,
}

impl Default for FsrsConfig {
    fn default() -> Self {
        FsrsConfig {
            weights: DEFAULT_WEIGHTS,
            request_retention: 0.9,
        }
    }
}

/// Result of an FSRS scheduling calculation.
pub struct FsrsResult {
    pub stability: f64,
    pub difficulty: f64,
    pub state: String,
    pub interval: i64,
    /// "YYYY-MM-DD" of the next review.
    pub next: String,
}

fn clamp_difficulty(d: f64) -> f64 {
    d.clamp(1.0, 10.0)
}

fn init_difficulty(w: &[f64; W_LEN], grade: i64) -> f64 {
    clamp_difficulty(w[4] - (grade as f64 - 3.0) * w[5])
}

fn init_stability(w: &[f64; W_LEN], grade: i64) -> f64 {
    w[(grade - 1).clamp(0, 3) as usize].max(0.1)
}

/// Retrievability after `t` days at stability `s` (FSRS-4.5 forgetting curve).
fn retrievability(t: f64, s: f64) -> f64 {
    (1.0 + t / (9.0 * s)).powf(-1.0)
}

fn next_difficulty(w: &[f64; W_LEN], d: f64, grade: i64) -> f64 {
    let next = d - w[6] * (grade as f64 - 3.0);
    // Mean reversion toward the "Good" initial difficulty.
    clamp_difficulty(w[7] * w[4] + (1.0 - w[7]) * next)
}

fn next_recall_stability(w: &[f64; W_LEN], d: f64, s: f64, r: f64, grade: i64) -> f64 {
    let hard_penalty = if grade == 2 { w[15] } else { 1.0 };
    let easy_bonus = if grade == 4 { w[16] } else { 1.0 };
    let factor = (w[8].exp() * (11.0 - d) * s.powf(-w[9]) * ((1.0 - r) * w[10]).exp_m1())
        * hard_penalty
        * easy_bonus;
    (s * (1.0 + factor)).max(0.1)
}

fn next_forget_stability(w: &[f64; W_LEN], d: f64, s: f64, r: f64) -> f64 {
    (w[11] * d.powf(-w[12]) * ((s + 1.0).powf(w[13]) - 1.0) * ((1.0 - r) * w[14]).exp()).max(0.1)
}

/// Run one FSRS review step.
///
/// `grade`: 1..=4. `stability`/`difficulty`: current values (0 if never reviewed
/// under FSRS). `state`: "new" treats this as the card's first FSRS review.
/// `elapsed_days`: days since the last review (ignored for a first review).
pub fn fsrs(
    grade: i64,
    stability: f64,
    difficulty: f64,
    state: &str,
    elapsed_days: i64,
    cfg: &FsrsConfig,
) -> FsrsResult {
    let w = &cfg.weights;
    let grade = grade.clamp(1, 4);
    let first = state == "new" || stability <= 0.0;

    let (new_stability, new_difficulty, lapsed) = if first {
        (init_stability(w, grade), init_difficulty(w, grade), false)
    } else {
        let r = retrievability(elapsed_days.max(0) as f64, stability);
        let d = next_difficulty(w, difficulty, grade);
        if grade == 1 {
            (next_forget_stability(w, difficulty, stability, r), d, true)
        } else {
            (next_recall_stability(w, difficulty, stability, r, grade), d, false)
        }
    };

    let new_state = if lapsed { "relearning" } else { "review" };

    // Interval that lands retrievability on request_retention: t = 9·S·(1/r − 1).
    let raw = 9.0 * new_stability * (1.0 / cfg.request_retention - 1.0);
    let interval = (raw.round() as i64).max(1);
    let next_date = Local::now().date_naive() + Duration::days(interval);

    FsrsResult {
        stability: new_stability,
        difficulty: new_difficulty,
        state: new_state.to_string(),
        interval,
        next: next_date.format("%Y-%m-%d").to_string(),
    }
}

/// Maps the four review buttons to FSRS grades (1=Again .. 4=Easy).
pub fn grade_from_rating(rating: &str) -> i64 {
    match rating {
        "forgot" => 1,
        "hard" => 2,
        "good" => 3,
        "easy" => 4,
        _ => 3,
    }
}
