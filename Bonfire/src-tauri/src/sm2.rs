use chrono::{Duration, Local};

/// Result of an SM-2 scheduling calculation.
pub struct Sm2Result {
    pub interval: i64,
    pub repetitions: i64,
    pub ease: f64,
    /// "YYYY-MM-DD" of the next review.
    pub next: String,
}

/// SM-2 spaced-repetition algorithm.
///
/// `quality`: 0..=5 recall grade (see [`quality_from_rating`]).
/// Ported 1:1 from the original Qt `sm2.h`.
pub fn sm2(quality: i64, interval: i64, repetitions: i64, ease: f64) -> Sm2Result {
    let (new_interval, new_reps) = if quality < 3 {
        // Failed recall: reset the schedule.
        (1, 0)
    } else {
        let reps = repetitions + 1;
        let next_interval = match reps {
            1 => 1,
            2 => 6,
            _ => (interval as f64 * ease).round() as i64,
        };
        (next_interval, reps)
    };

    // Ease factor update (floored at 1.3).
    let q = quality as f64;
    let new_ease = (ease + 0.1 - (5.0 - q) * (0.08 + (5.0 - q) * 0.02)).max(1.3);

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
