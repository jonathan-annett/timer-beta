# Changelog

One entry per shipped version (`npm run ship -- "what changed"` writes it).

## 0.1.19
- Phone page: every glasses menu action as a button; Taps for Next can be Off

## 0.1.18
- Presenter chooses what shows beside the countdown (messages by default); operator Quiet on/off; Minimal view sits in the corner (Next corner moves it); presenters see Timer offline only after 60 s down

## 0.1.17
- Operator Minimal view sits in the corner (Next corner moves it); presenters see Timer offline only after 60 s down

## 0.1.16
- Dev copy keeps its own pairing and settings (the Even app's storage is shared between plugins)

## 0.1.15
- Message layers: presenter chooses what shows (messages by default); quiet mode; operator Quiet on/off

## 0.1.14
- A 2-second hold toggles Minimal view (operator); not when it follows a tap

## 0.1.13
- Operator: Next on the 3rd tap (or 4th or 5th, set on the phone page), at once; menu: Next, Back, Pause / resume, Reset show, Auto start on / off, Minimal view; standby and auto start shown on the glasses

## 0.1.12
- Fix: the glasses rebooted after Next (whole-page rebuilds in a hurry); boxes now stay put and only their text changes

## 0.1.11
- The phone page shows what the glasses show (a stand-in, and where the countdown sits)

## 0.1.10
- QR pairing takes a photo with the Even app's camera (the page itself isn't allowed the camera)

## 0.1.9
- Pair by scanning the share panel's Countdown QR code with the phone's camera, as well as by the 6-digit code

## 0.1.8
- Roles set on the timer: presenter (corner countdown; a tap hides or shows it) or operator (elapsed, total, message, countdown, started, ends; three taps fire Next)

## 0.1.7
- The glasses page and its menu are sent exactly as Mischief Mews sends them

## 0.1.6
- Next corner in the glasses' menu (built as the starter kit builds its menu)

## 0.1.5
- The pairing and corner are kept by the Even app, so they survive closing and reopening the plugin

## 0.1.4
- Next corner in the glasses' menu (tap, then tap and hold); the page's setup result is checked

## 0.1.3
- First version: pairs with a beta.timed-show.com timer by its 6-digit code; the countdown, small and dim, in a corner chosen on the phone.

## 0.1.2
- First version: pairs with a timer at beta.timed-show.com by its 6-digit code; the countdown, small and dim, in a corner chosen on the phone.
