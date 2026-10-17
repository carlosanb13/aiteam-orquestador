(function () {
  'use strict';

  const form = document.getElementById('task-form');
  const input = document.getElementById('task-input');
  const addButton = document.getElementById('task-add');
  const count = document.getElementById('task-count');
  const list = document.getElementById('task-list');
  const empty = document.getElementById('task-empty');

  if (!form || !input || !addButton || !count || !list || !empty) {
    console.warn('Equipo en acción: faltan elementos necesarios para la lista de tareas.');
    return;
  }

  const tasks = [];
  let nextId = 1;

  function createTaskItem(task) {
    const item = document.createElement('li');
    item.className = 'task-item';
    item.dataset.id = String(task.id);
    if (task.done) item.classList.add('is-done');

    const label = document.createElement('label');
    label.className = 'task-label';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'task-toggle';
    toggle.checked = task.done;

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;

    label.append(toggle, text);
    item.append(label);
    return item;
  }

  function updateStatus() {
    const completed = tasks.filter((task) => task.done).length;
    count.textContent = tasks.length === 0
      ? 'Sin tareas'
      : `${completed} de ${tasks.length} completadas`;
    empty.hidden = tasks.length > 0;
  }

  function render() {
    list.replaceChildren(...tasks.map(createTaskItem));
    updateStatus();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    tasks.push({ id: nextId++, text, done: false });
    input.value = '';
    input.focus();
    render();
  });

  list.addEventListener('change', (event) => {
    const toggle = event.target;
    if (!(toggle instanceof HTMLInputElement) || !toggle.classList.contains('task-toggle')) return;

    const item = toggle.closest('li[data-id]');
    if (!item || !list.contains(item)) return;

    const task = tasks.find((candidate) => String(candidate.id) === item.dataset.id);
    if (!task) return;

    task.done = toggle.checked;
    item.classList.toggle('is-done', task.done);
    updateStatus();
  });

  render();
}());
