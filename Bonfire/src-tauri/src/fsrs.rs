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

/// Per-weight `(min, max)`, taken from the FSRS optimizer's own `WeightClipper` —
/// the range the model is fitted within. The settings UI mirrors these, but the
/// clamp has to live here too: these values drive scheduling, and a limit that only
/// exists in the frontend is not a limit.
pub const WEIGHT_BOUNDS: [(f64, f64); W_LEN] = [
    (0.01, 100.0), // 0  initial stability, Again
    (0.01, 100.0), // 1  initial stability, Hard
    (0.01, 100.0), // 2  initial stability, Good
    (0.01, 100.0), // 3  initial stability, Easy
    (1.0, 10.0),   // 4  initial difficulty base
    (0.1, 5.0),    // 5  initial difficulty spread per grade
    (0.1, 5.0),    // 6  difficulty change per grade
    (0.0, 0.75),   // 7  difficulty mean-reversion strength
    (0.0, 4.0),    // 8  stability growth scale
    (0.0, 0.8),    // 9  stability saturation
    (0.01, 3.0),   // 10 low-retrievability bonus
    (0.5, 5.0),    // 11 post-lapse stability scale
    (0.01, 0.2),   // 12 post-lapse difficulty penalty
    (0.01, 0.9),   // 13 post-lapse stability exponent
    (0.01, 3.0),   // 14 post-lapse retrievability factor
    (0.0, 1.0),    // 15 Hard penalty
    (1.0, 6.0),    // 16 Easy bonus
];

/// Allowed range for request retention. The floor is deliberate: below 0.90 the
/// intervals a single "Good" earns grow fast enough to feel like the card vanished.
pub const RETENTION_BOUNDS: (f64, f64) = (0.90, 0.99);

/// The published FSRS default retention, and what "reset" restores.
pub const DEFAULT_RETENTION: f64 = 0.90;

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
            request_retention: DEFAULT_RETENTION,
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
    let raw = w[11] * d.powf(-w[12]) * ((s + 1.0).powf(w[13]) - 1.0) * ((1.0 - r) * w[14]).exp();
    // Upstream clamps this to the pre-lapse stability. Without the clamp a lapse on a
    // low-stability card can *raise* it — forgetting a card would schedule it further
    // out than remembering it did.
    raw.min(s).max(0.1)
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
        // The *new* difficulty drives the stability update, matching upstream — the
        // grade you just gave is supposed to be reflected in both, not only in D.
        let d = next_difficulty(w, difficulty, grade);
        if grade == 1 {
            (next_forget_stability(w, d, stability, r), d, true)
        } else {
            (next_recall_stability(w, d, stability, r, grade), d, false)
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
///
/// Older review-log rows may carry ratings the buttons no longer offer; they fall
/// through to "good" here, but nothing replays the log through the scheduler.
pub fn grade_from_rating(rating: &str) -> i64 {
    match rating {
        "forgot" => 1,
        "hard" => 2,
        "good" => 3,
        "easy" => 4,
        _ => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_weights_match_the_declared_length() {
        assert_eq!(DEFAULT_WEIGHTS.len(), W_LEN);
        assert_eq!(FsrsConfig::default().weights.len(), W_LEN);
    }

    #[test]
    fn retrievability_decays_from_one_and_stays_bounded() {
        // R = (1 + t/9S)^-1: full recall at t=0, monotonically decaying after.
        assert!((retrievability(0.0, 10.0) - 1.0).abs() < 1e-9);
        let (a, b) = (retrievability(10.0, 10.0), retrievability(100.0, 10.0));
        assert!(a > b, "recall probability must decay with elapsed time");
        assert!(b > 0.0 && a < 1.0);
    }

    #[test]
    fn a_new_card_enters_review_and_a_lapse_enters_relearning() {
        let cfg = FsrsConfig::default();
        assert_eq!(fsrs(3, 0.0, 0.0, "new", 0, &cfg).state, "review");
        let lapse = fsrs(1, 10.0, 5.0, "review", 10, &cfg);
        assert_eq!(lapse.state, "relearning");
    }

    #[test]
    fn better_grades_schedule_further_out() {
        let cfg = FsrsConfig::default();
        let at = |g| fsrs(g, 10.0, 5.0, "review", 10, &cfg).interval;
        assert!(at(2) <= at(3) && at(3) <= at(4), "hard <= good <= easy");
        assert!(at(1) <= at(2), "a lapse must not schedule further than hard");
    }

    #[test]
    fn intervals_are_always_at_least_one_day() {
        let cfg = FsrsConfig::default();
        // A card with almost no stability must still land tomorrow, not today.
        assert!(fsrs(1, 0.01, 9.0, "review", 365, &cfg).interval >= 1);
    }

    #[test]
    fn ratings_map_to_the_documented_grades() {
        assert_eq!(grade_from_rating("forgot"), 1);
        assert_eq!(grade_from_rating("hard"), 2);
        assert_eq!(grade_from_rating("good"), 3);
        assert_eq!(grade_from_rating("easy"), 4);
        assert_eq!(grade_from_rating("nonsense"), 3, "unknown falls back to good");
        // Ratings retired in 0.4.0 still appear in old review_log rows.
        assert_eq!(grade_from_rating("bombed"), 3);
        assert_eq!(grade_from_rating("supereasy"), 3);
    }

    /// Run `grades` in sequence, reviewing each card exactly when it was scheduled.
    fn ladder(grades: &[i64], retention: f64) -> Vec<i64> {
        let cfg = FsrsConfig {
            request_retention: retention,
            ..FsrsConfig::default()
        };
        let (mut s, mut d, mut state, mut iv) = (0.0, 0.0, "new".to_string(), 0);
        grades
            .iter()
            .map(|&g| {
                let r = fsrs(g, s, d, &state, iv, &cfg);
                s = r.stability;
                d = r.difficulty;
                state = r.state;
                iv = r.interval;
                iv
            })
            .collect()
    }

    #[test]
    fn a_lapse_never_raises_stability() {
        let cfg = FsrsConfig::default();
        for &s in &[0.1, 0.4, 1.0, 2.5, 8.0, 40.0, 232.0] {
            for &d in &[1.0, 2.0, 5.0, 9.0, 10.0] {
                // Reviewed on time, and well overdue — the overdue case is where the
                // missing clamp used to let "Forgot" increase stability.
                for &elapsed in &[0, 1, 3, 30, 400] {
                    let out = fsrs(1, s, d, "review", elapsed, &cfg);
                    assert!(
                        out.stability <= s + 1e-9,
                        "forgetting raised stability: S={s} D={d} elapsed={elapsed} -> {}",
                        out.stability
                    );
                }
            }
        }
    }

    #[test]
    fn grades_stay_ordered_over_a_long_run() {
        let hard = ladder(&[2; 12], 0.95);
        let good = ladder(&[3; 12], 0.95);
        let easy = ladder(&[4; 12], 0.95);
        for i in 0..12 {
            assert!(hard[i] <= good[i], "hard outran good at step {i}");
            assert!(good[i] <= easy[i], "good outran easy at step {i}");
        }
        assert!(good[11] > 10 * good[0], "good should stretch out substantially");
        assert!(easy[11] > good[11], "easy should end further out than good");
    }

    #[test]
    fn hard_keeps_a_card_in_daily_rotation() {
        // Hard is a successful recall, so stability does creep up — but at the shipped
        // retention the rounded interval stays at one day however long you keep pressing
        // it. "Hard means I see it more" is a property worth holding onto.
        assert_eq!(ladder(&[2; 12], 0.95), vec![1; 12]);
    }

    #[test]
    fn forgetting_repeatedly_pins_the_card_to_tomorrow() {
        assert_eq!(ladder(&[1; 8], 0.95), vec![1; 8]);
    }

    #[test]
    fn the_good_ladder_at_the_shipped_retention_is_locked() {
        // Regression lock: the schedule the user actually studies against.
        assert_eq!(
            ladder(&[3; 10], 0.95),
            vec![1, 2, 4, 7, 12, 20, 32, 49, 75, 111]
        );
    }

    #[test]
    fn every_weight_at_its_documented_bounds_still_schedules() {
        // The settings UI lets each weight be set anywhere in its published range;
        // no corner of that range may produce NaN, a negative interval, or a panic.
        for (i, &(lo, hi)) in WEIGHT_BOUNDS.iter().enumerate() {
            for &edge in &[lo, hi] {
                let mut cfg = FsrsConfig {
                    request_retention: 0.99,
                    ..FsrsConfig::default()
                };
                cfg.weights[i] = edge;
                for grade in 1..=4 {
                    for &(s, d, state) in
                        &[(0.0, 0.0, "new"), (1.0, 5.0, "review"), (232.0, 9.9, "review")]
                    {
                        let r = fsrs(grade, s, d, state, 10, &cfg);
                        assert!(
                            r.stability.is_finite() && r.difficulty.is_finite(),
                            "w[{i}]={edge} grade={grade} produced a non-finite state"
                        );
                        assert!(r.interval >= 1, "w[{i}]={edge} produced interval {}", r.interval);
                        assert!((1.0..=10.0).contains(&r.difficulty));
                    }
                }
            }
        }
    }

    #[test]
    fn the_default_weights_sit_inside_their_bounds() {
        for (i, &w) in DEFAULT_WEIGHTS.iter().enumerate() {
            let (lo, hi) = WEIGHT_BOUNDS[i];
            assert!(
                (lo..=hi).contains(&w),
                "default w[{i}]={w} is outside its own bound {lo}..={hi}"
            );
        }
    }
}

