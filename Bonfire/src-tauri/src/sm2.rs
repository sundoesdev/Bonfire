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

/// Maps the review buttons to SM-2 quality grades.
///
/// SM-2's scale is 0..=5 and "forgot"/"easy" already sit on both ends, so the two
/// outer buttons share their neighbour's quality here and are separated afterwards
/// by [`adjust_for_rating`].
pub fn quality_from_rating(rating: &str) -> i64 {
    match rating {
        "bombed" | "forgot" => 0,
        "hard" => 3,
        "good" => 4,
        "easy" | "supereasy" => 5,
        _ => 4,
    }
}

/// How much further than "easy" the "super easy" button pushes a card out.
const SUPER_EASY_MULTIPLIER: f64 = 2.0;

/// Apply the two buttons that sit outside SM-2's own scale.
///
/// "Bombed it" pins the card to today, so it comes back within hours rather than
/// tomorrow at the earliest. "Super easy" doubles the interval SM-2 computed, for
/// cards so well known that a month is soon enough. Every other rating passes
/// through untouched.
pub fn adjust_for_rating(rating: &str, r: Sm2Result) -> Sm2Result {
    let interval = match rating {
        "bombed" => 0,
        "supereasy" => ((r.interval as f64 * SUPER_EASY_MULTIPLIER).round() as i64).max(1),
        _ => return r,
    };
    Sm2Result {
        interval,
        // A bombed card is not a step forward — reset the ladder like any lapse.
        repetitions: if rating == "bombed" { 0 } else { r.repetitions },
        ease: r.ease,
        next: (Local::now().date_naive() + Duration::days(interval))
            .format("%Y-%m-%d")
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_two_intervals_are_the_fixed_ladder() {
        let cfg = Sm2Config::default();
        assert_eq!(sm2(4, 0, 0, 2.5, &cfg).interval, 1);
        assert_eq!(sm2(4, 1, 1, 2.5, &cfg).interval, 6);
    }

    #[test]
    fn a_lapse_resets_the_schedule() {
        let cfg = Sm2Config::default();
        let r = sm2(quality_from_rating("forgot"), 30, 5, 2.5, &cfg);
        assert_eq!(r.interval, 1);
        assert_eq!(r.repetitions, 0);
        assert!(r.ease < 2.5, "a lapse must also lower ease");
    }

    #[test]
    fn ease_never_falls_below_the_floor() {
        let cfg = Sm2Config::default();
        let mut ease = 2.5;
        for _ in 0..20 {
            ease = sm2(0, 10, 3, ease, &cfg).ease;
        }
        assert!(ease >= cfg.ease_floor, "ease {ease} broke the floor");
    }

    #[test]
    fn graduated_reviews_grow_by_ease_and_hard_grows_slower() {
        let cfg = Sm2Config::default();
        let good = sm2(quality_from_rating("good"), 10, 3, 2.5, &cfg).interval;
        let hard = sm2(quality_from_rating("hard"), 10, 3, 2.5, &cfg).interval;
        assert_eq!(good, 25); // 10 * 2.5
        assert_eq!(hard, 12); // 10 * 1.2
        assert!(hard < good);
    }

    #[test]
    fn ratings_map_to_the_documented_grades() {
        assert_eq!(quality_from_rating("bombed"), 0);
        assert_eq!(quality_from_rating("forgot"), 0);
        assert_eq!(quality_from_rating("hard"), 3);
        assert_eq!(quality_from_rating("good"), 4);
        assert_eq!(quality_from_rating("easy"), 5);
        assert_eq!(quality_from_rating("supereasy"), 5);
        assert_eq!(quality_from_rating("nonsense"), 4, "unknown falls back to good");
    }

    #[test]
    fn bombed_brings_the_card_back_today() {
        let cfg = Sm2Config::default();
        let r = adjust_for_rating("bombed", sm2(quality_from_rating("bombed"), 30, 5, 2.5, &cfg));
        assert_eq!(r.interval, 0);
        assert_eq!(r.repetitions, 0);
        assert_eq!(r.next, Local::now().date_naive().format("%Y-%m-%d").to_string());
    }

    #[test]
    fn super_easy_pushes_out_twice_as_far_as_easy() {
        let cfg = Sm2Config::default();
        let easy = adjust_for_rating("easy", sm2(quality_from_rating("easy"), 10, 3, 2.5, &cfg));
        let sup = adjust_for_rating(
            "supereasy",
            sm2(quality_from_rating("supereasy"), 10, 3, 2.5, &cfg),
        );
        assert_eq!(sup.interval, easy.interval * 2);
        assert!(sup.next > easy.next);
    }

    #[test]
    fn the_ordinary_ratings_pass_through_untouched() {
        let cfg = Sm2Config::default();
        for rating in ["forgot", "hard", "good", "easy"] {
            let base = sm2(quality_from_rating(rating), 10, 3, 2.5, &cfg);
            let (i, reps, next) = (base.interval, base.repetitions, base.next.clone());
            let out = adjust_for_rating(rating, base);
            assert_eq!((out.interval, out.repetitions, out.next), (i, reps, next), "{rating}");
        }
    }
}
