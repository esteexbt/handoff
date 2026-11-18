---
name: Sprout
url: http://localhost:4173
start: node server.js
---

# Sprout

Sprout reminds you when each of your plants needs water. This is the launch page:
a waitlist, simple pricing, and a short FAQ. Built by a coding agent from this spec.

## Brand

- Sprout green: #1F6F4A
- Cream: #F6F3EA
- Ink: #14161A
- Type: Fraunces for headings, Inter for body
- Voice: calm and short. No exclamation marks.

## Checks

- join-waitlist: Enter "ada@example.com" in the email field, click "Join the waitlist", and verify the page shows the message "You're on the list"
- reject-bad-email: Enter "ada@example" in the email field, click "Join the waitlist", and verify an error saying "Enter a valid email address" is shown and the message "You're on the list" is not shown
- yearly-pricing: Click the "Yearly" billing option and verify the Grow plan price shows "$48" per year
- faq-cancel: Click the question "Can I cancel anytime?" and verify the answer "Yes. Cancel in one click from Settings." becomes visible
- nav-pricing: Click "Pricing" in the top navigation and verify the pricing section with the "Grow" plan is visible
