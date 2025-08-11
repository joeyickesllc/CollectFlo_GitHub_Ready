
async function loadTemplates() {
  const response = await fetch('/api/templates');
  const templates = await response.json();
  
  const tbody = document.getElementById('templateTableBody');
  tbody.innerHTML = templates.map(template => `
    <tr data-id="${template.id}">
      <td class="px-6 py-4">${template.day_offset}</td>
      <td class="px-6 py-4">${template.channel}</td>
      <td class="px-6 py-4 editable" contenteditable>${template.subject}</td>
      <td class="px-6 py-4 editable" contenteditable>${template.body}</td>
      <td class="px-6 py-4">
        <button onclick="saveTemplate(${template.id})" class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors">Save</button>
      </td>
    </tr>
  `).join('');
}

async function saveTemplate(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  const template = {
    id,
    subject: row.children[2].textContent,
    body: row.children[3].textContent
  };
  
  await fetch(`/api/templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template)
  });
}

// Make available to inline onclick handlers
window.saveTemplate = saveTemplate;

loadTemplates();
