(function () {
  const dashboard = document.getElementById('dashboard');
  const statusDot = document.getElementById('status-indicator');

  function timeAgo(isoString) {
    if (!isoString) return '';
    const diff = Date.now() - new Date(isoString).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return seconds + 's ago';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function statusBadgeClass(status) {
    if (!status) return 'unknown';
    const s = status.toUpperCase();
    if (s === 'ACTIVE' || s === 'IN PROGRESS') return 'active';
    if (s === 'SHIPPED') return 'shipped';
    if (s === 'KILLED') return 'killed';
    return 'unknown';
  }

  function renderEmpty(error) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    const h2 = document.createElement('h2');
    h2.textContent = 'No dominoes are falling.';
    div.appendChild(h2);

    const p = document.createElement('p');
    if (error === 'directory_missing') {
      p.textContent = '~/.gauntlette/ is empty or missing.';
    } else {
      p.textContent = 'No plan files found.';
    }
    div.appendChild(p);

    const p2 = document.createElement('p');
    p2.textContent = 'Run /survey in a project to start tracking.';
    div.appendChild(p2);

    return div;
  }

  function renderStage(stage, index) {
    const div = document.createElement('div');
    div.className = 'stage ' + stage.visual;

    const num = document.createElement('span');
    num.className = 'stage-number';
    num.textContent = index + 1;
    div.appendChild(num);

    const name = document.createElement('div');
    name.className = 'stage-name';
    name.textContent = stage.name;
    name.title = stage.name + ': ' + stage.status;
    div.appendChild(name);

    return div;
  }

  function renderPlan(plan) {
    const card = document.createElement('div');
    card.className = 'plan-card' + (plan.error ? ' has-error' : '');

    // Header row
    const header = document.createElement('div');
    header.className = 'plan-header';

    const nameEl = document.createElement('div');
    nameEl.className = 'plan-name';

    const repo = document.createElement('span');
    repo.className = 'repo';
    repo.textContent = plan.repo;
    nameEl.appendChild(repo);

    const sep = document.createElement('span');
    sep.className = 'separator';
    sep.textContent = ':';
    nameEl.appendChild(sep);

    const planName = document.createElement('span');
    planName.textContent = plan.name;
    nameEl.appendChild(planName);

    header.appendChild(nameEl);

    const badge = document.createElement('span');
    badge.className = 'status-badge ' + statusBadgeClass(plan.status);
    badge.textContent = plan.status;
    header.appendChild(badge);

    card.appendChild(header);

    // Progress bar — show completed, current, and future stages
    // Hide: skipped stages (no file, but later stages completed — jumped over)
    const visibleStages = plan.stages.filter(function (s) {
      return s.visual === 'completed' || s.visual === 'clear' || s.visual === 'pending';
    });
    // Mark the first pending stage as "current" — that's where we are in the pipeline
    var currentFound = false;
    for (var vi = 0; vi < visibleStages.length; vi++) {
      if (visibleStages[vi].visual === 'pending' && !currentFound) {
        visibleStages[vi] = Object.assign({}, visibleStages[vi], { visual: 'current' });
        currentFound = true;
      }
    }
    if (visibleStages.length > 0) {
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      for (let si = 0; si < visibleStages.length; si++) {
        bar.appendChild(renderStage(visibleStages[si], si));
      }
      card.appendChild(bar);
    } else if (!plan.error) {
      const noStages = document.createElement('div');
      noStages.className = 'no-stages';
      noStages.textContent = 'No review pipeline';
      card.appendChild(noStages);
    }

    // Error
    if (plan.error) {
      const err = document.createElement('div');
      err.className = 'plan-error';
      err.textContent = plan.error;
      card.appendChild(err);
    }

    // Meta
    const meta = document.createElement('div');
    meta.className = 'plan-meta';

    if (plan.lastModified) {
      const updated = document.createElement('span');
      updated.textContent = 'Updated ' + timeAgo(plan.lastModified);
      meta.appendChild(updated);
    }

    if (plan.title && plan.title !== plan.name) {
      const title = document.createElement('span');
      title.textContent = plan.title;
      meta.appendChild(title);
    }

    card.appendChild(meta);

    return card;
  }

  function render(data) {
    dashboard.innerHTML = '';

    if (!data.plans || data.plans.length === 0) {
      dashboard.appendChild(renderEmpty(data.error));
      return;
    }

    for (const plan of data.plans) {
      dashboard.appendChild(renderPlan(plan));
    }
  }

  // SSE connection
  function connect() {
    const es = new EventSource('/events');

    es.onmessage = function (e) {
      statusDot.classList.remove('disconnected');
      try {
        const data = JSON.parse(e.data);
        render(data);
      } catch (err) {
        console.error('Failed to parse SSE data:', err);
      }
    };

    es.onerror = function () {
      statusDot.classList.add('disconnected');
    };

    es.onopen = function () {
      statusDot.classList.remove('disconnected');
    };
  }

  connect();
})();
