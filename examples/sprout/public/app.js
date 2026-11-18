// Sprout launch page — first pass, written by the coding agent from handoff.md.

const form = document.getElementById('waitlist');
const email = document.getElementById('email');
const error = document.getElementById('form-error');
const success = document.getElementById('form-success');

function isEmail(value) {
  return value.includes('@');
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = email.value.trim();
  error.hidden = true;
  success.hidden = true;
  if (!isEmail(value)) {
    error.textContent = 'Enter a valid email address';
    error.hidden = false;
    return;
  }
  success.textContent = "You're on the list. We'll write when Sprout is ready.";
  success.hidden = false;
  form.reset();
});

// Pricing toggle
const MONTHLY = 5;
const price = document.getElementById('grow-price');
const period = document.getElementById('grow-period');

document.querySelectorAll('.toggle button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle button').forEach((b) => b.classList.toggle('active', b === btn));
    if (btn.dataset.period === 'yearly') {
      price.textContent = `$${MONTHLY * 12}`;
      period.textContent = 'per year';
    } else {
      price.textContent = `$${MONTHLY}`;
      period.textContent = 'per month';
    }
  });
});
