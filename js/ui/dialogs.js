/* Los controles de salida quedan fuera del contenido que se desplaza.
 * Mantiene los nodos y sus listeners; no cambia qué significa cerrar cada pantalla.
 */
(() => {
  const dismiss = '[data-back], #news-close, #sup-close, #set-close, #legal-close, #prof-close, #mod-back, #lobby-menu';
  for (const box of document.querySelectorAll('.scr > .box')) {
    const header = box.firstElementChild;
    if (!header || !header.querySelector(dismiss)) continue;
    box.classList.add('dialog-frame');
    header.classList.add('dialog-head');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    while (header.nextSibling) body.appendChild(header.nextSibling);
    box.appendChild(body);
  }
  for (const id of ['starter-back', 'btn-resume', 'btn-again', 'nick-later']) {
    const button = document.getElementById(id), box = button.closest('.box');
    const footer = button.parentElement === box ? button : button.parentElement;
    box.classList.add('dialog-frame');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    for (const node of [...box.childNodes]) if (node !== footer) body.appendChild(node);
    box.prepend(body);
    footer.classList.add('dialog-foot');
  }
})();
