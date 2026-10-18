/* Compact, direct reward choices. Information belongs to the delayed skill readout. */
G.ChoiceCards = (() => {
  const states = new WeakMap();
  function render(box, choices) {
    const state = { locked: false }; states.set(box, state);
    box.innerHTML = ''; box.classList.remove('done');
    choices.forEach((choice, index) => {
      const card = document.createElement('div'); card.className = 'card choice-card' + (choice.variant ? ' ' + choice.variant : '');
      card.innerHTML = `<button type="button" class="choice-pick" data-tip="${choice.source}" data-sfx="none">${choice.type ? G.TypeIcons.badge(choice.type) : ''}<span class="ico">${G.Icons.html(choice.icon, 32)}</span>
        <span class="txt"><span class="choice-title"><span class="nm">${choice.title}</span>${choice.tag}</span><span class="ds">${choice.desc || ''}</span></span>
        <span class="choice-corner"><span class="key" aria-hidden="true">${index + 1}</span></span></button>`;
      const button = card.firstElementChild;
      button.onclick = () => { if (!state.locked) { state.locked = true; choice.onPick(); } };
      button.onkeydown = e => {
        if ([' ', 'Enter', 'Tab'].includes(e.key)) e.stopPropagation();
        if (e.repeat && [' ', 'Enter'].includes(e.key)) { e.preventDefault(); return; }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : Math.max(0, Math.min(choices.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1)));
        box.querySelectorAll('.choice-pick')[next]?.focus();
      };
      box.appendChild(card);
    });
  }
  function focusFirst(box) { box.querySelector('.choice-pick:not(:disabled)')?.focus({ preventScroll: true }); }
  function lock(box, index) {
    const state = states.get(box); if (state) state.locked = true;
    box.querySelectorAll('.card').forEach((card, i) => { card.classList.toggle('picked', i === index); card.firstElementChild.disabled = true; });
    box.classList.add('done');
  }
  function release(box) { states.delete(box); }
  return { render, focusFirst, lock, release };
})();
