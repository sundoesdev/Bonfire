use chrono::{Duration, Local};

/// Result of an SM-2 scheduling calculation.
pub struct Sm2Result {
    pub interval: i64,
    pub repetitions: i64,
    pub ease: f64,
    /// "YYYY-MM-DD" of the next review.
    pub next: String,
}

/// User-tunable SM-2 knobs (see the "Spaced repetition" settings section).
/// The defaults reproduce the original 1:1 port behaviour.
pub struct Sm2Config {
    /// Lower bound for the ease factor.
    pub ease_floor: f64,
    /// Multiplier applied to graduated (rep ≥ 3) review intervals.
    pub interval_modifier: f64,
    /// Interval multiplier used on a "hard" (quality 3) graduated review,
    /// instead of the ease factor.
    pub hard_multiplier: f64,
}

impl Default for Sm2Config {
    fn default() -> Self {
        Sm2Config {
            ease_floor: 1.3,
            interval_modifier: 1.0,
            hard_multiplier: 1.2,
        }
    }
}

/// SM-2 spaced-repetition algorithm.
///
/// `quality`: 0..=5 recall grade (see [`quality_from_rating`]).
/// Ported 1:1 from the original Qt `sm2.h`, with optional configurable knobs.
pub fn sm2(quality: i64, interval: i64, repetitions: i64, ease: f64, cfg: &Sm2Config) -> Sm2Result {
    let (new_interval, new_reps) = if quality < 3 {
        // Failed recall: reset the schedule.
        (1, 0)
    } else {
        let reps = repetitions + 1;
        let next_interval = match reps {
            1 => 1,
            2 => 6,
            // Graduated review: "hard" grows by hard_multiplier, others by ease;
            // the global interval modifier scales the result.
            _ => {
                let mult = if quality == 3 { cfg.hard_multiplier } else { ease };
                (interval as f64 * mult * cfg.interval_modifier).round() as i64
            }
        };
        (next_interval.max(1), reps)
    };

    // Ease factor update (floored at the configured ease floor).
    let q = quality as f64;
    let new_ease = (ease + 0.1 - (5.0 - q) * (0.08 + (5.0 - q) * 0.02)).max(cfg.ease_floor);

    let next_date = Local::now().date_naive() + Duration::days(new_interval);

    Sm2Result {
        interval: new_interval,
        repetitions: new_reps,
        ease: new_ease,
        next: next_date.format("%Y-%m-%d").to_string(),
    }
}

/// Maps the four review buttons to SM-2 quality grades.
pub fn quality_from_rating(rating: &str) -> i64 {
    match rating {
        "forgot" => 0,
        "hard" => 3,
        "good" => 4,
        "easy" => 5,
        _ => 4,
    }
}
