# Calorie & Weight Tracker

A mobile-first page that runs entirely in the browser. Food, workouts, and weight stay in `localStorage` on the device. Nothing is uploaded.

Site: https://tunafinn.github.io/calorie-tracker/

## Tracker

- Baseline burn is 3,400 kcal/day (141.7 kcal/hour) starting at `2026-10-24T01:00:00-05:00` (1:00 AM CT on Oct 24, 2026). That start time is fixed. Clearing the log does not change it.
- Food subtracts from the net. A workout adds extra calories burned.
- Net = total burned − total eaten. Total burned is the baseline plus workouts.
- Today, yesterday, this week, and this month show that same net for each Chicago calendar period, plus a day-by-day and month-by-month history. A positive net is a deficit. A negative net is a surplus.
- The loss goal is 120 lb at 3,500 kcal/lb, which is a 420,000 kcal deficit.
- Weight starts at 345 lb. The chart draws a goal line at 225 lb.

## Backup

Export JSON downloads a backup file. Import JSON replaces the food, workout, and weight logs on this device. The file stays local unless you move it yourself.

## Home screen

The page includes a web app manifest, icons, and a service worker so it can be added to the home screen.

## Pages

`.github/workflows/pages.yml` publishes the default branch. In the repository settings, open **Pages → Build and deployment → Source** and choose **GitHub Actions**.
