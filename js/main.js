function toggleMobileMenu() {
  document.getElementById('mobile-menu').classList.toggle('hidden');
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const label = btn.querySelector('span');
    const old = label ? label.textContent : '';
    if (label) label.textContent = 'Copied';
    setTimeout(() => { if (label) label.textContent = old; }, 1600);
  });
}

function spawnFallingEmojis() {
  const left = document.getElementById('left-emojis');
  const right = document.getElementById('right-emojis');
  if (!left || !right) return;

  const emojis = ['🐸', '🦭', '🃏', '🌾', '🐻', '💚', '⚡', '🪙'];

  function drop(side) {
    const el = document.createElement('span');
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.cssText = [
      'position:absolute',
      'top:-2rem',
      'left:' + (10 + Math.random() * 60) + '%',
      'font-size:' + (16 + Math.random() * 14) + 'px',
      'opacity:' + (0.25 + Math.random() * 0.5),
      'animation:fall ' + (4 + Math.random() * 5) + 's linear forwards'
    ].join(';');
    side.appendChild(el);
    setTimeout(() => el.remove(), 9000);
  }

  setInterval(() => drop(left), 700);
  setInterval(() => drop(right), 850);
}

document.addEventListener('DOMContentLoaded', () => {
  spawnFallingEmojis();

  const form = document.getElementById('visitors-book-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = document.getElementById('result');
    const res = await fetch(form.action, { method: 'POST', body: new FormData(form) });
    const json = await res.json().catch(() => ({ success: false }));
    result.classList.remove('hidden');
    if (json.success) {
      result.className = 'text-center text-sm mt-2 text-emerald-400';
      result.textContent = 'Message sent. Thanks for signing the book.';
      form.reset();
    } else {
      result.className = 'text-center text-sm mt-2 text-red-400';
      result.textContent = 'Something went wrong. Try again.';
    }
  });
});
