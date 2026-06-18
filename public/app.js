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
    if (s === 'APPROVED') return 'approved';
    if (s === 'DRAFT') return 'draft';
    if (s === 'SUCCESS') return 'success';
    if (s === 'SHIPPED') return 'shipped';
    if (s === 'KILLED') return 'killed';
    return 'unknown';
  }

  function sourceBadgeClass(source) {
    if (source === 'gstack') return 'gstack';
    if (source === 'ark') return 'ark';
    return 'gauntlette';
  }

  function renderEmpty(error) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    const h2 = document.createElement('h2');
    h2.textContent = 'No dominoes are falling.';
    div.appendChild(h2);

    const p = document.createElement('p');
    if (error === 'directory_missing') {
      p.textContent = '~/.gauntlette/ is empty or missing, and no recent gstack workflows were found.';
    } else {
      p.textContent = 'No recent gauntlette or gstack workflows found.';
    }
    div.appendChild(p);

    const p2 = document.createElement('p');
    p2.textContent = 'Run /survey or generate a gstack review doc to start tracking.';
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
    // Surface the review-fix iteration count on the Adversarial stage (e.g. "ADVERSARIAL ×2").
    var label = stage.name;
    if (stage.iteration && stage.iteration > 1) {
      label = stage.name + ' ×' + stage.iteration;
    }
    name.textContent = label;
    name.title = stage.name + ': ' + stage.status
      + (stage.iteration ? ' (review-fix iteration ' + stage.iteration + ')' : '');
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

    const badges = document.createElement('div');
    badges.className = 'plan-badges';

    const source = document.createElement('span');
    source.className = 'source-badge ' + sourceBadgeClass(plan.source);
    source.textContent = plan.source || 'gauntlette';
    badges.appendChild(source);

    const badge = document.createElement('span');
    badge.className = 'status-badge ' + statusBadgeClass(plan.status);
    badge.textContent = plan.status;
    badges.appendChild(badge);

    if (plan.tmuxSession) {
      const attach = document.createElement('button');
      attach.className = 'attach-btn';
      attach.type = 'button';
      attach.textContent = '⧉ tmux';
      attach.title = 'Attach to ' + plan.tmuxSession;
      attach.addEventListener('click', function () {
        attach.disabled = true;
        fetch('/api/attach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: plan.tmuxSession }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (!res.ok) {
              attach.textContent = '✕ ' + (res.error || 'failed');
              attach.classList.add('attach-error');
            }
          })
          .catch(function () {
            attach.textContent = '✕ error';
            attach.classList.add('attach-error');
          })
          .finally(function () {
            setTimeout(function () {
              attach.disabled = false;
              attach.textContent = '⧉ tmux';
              attach.classList.remove('attach-error');
            }, 2000);
          });
      });
      badges.appendChild(attach);
    }

    header.appendChild(badges);

    card.appendChild(header);

    // Pizza tracker: all stages always visible, current one lights up red.
    const doneVisuals = new Set(['completed', 'clear', 'issues']);
    const visibleStages = plan.stages.filter(function (s) { return s.visual !== 'skipped'; });

    // Find or assign the current stage.
    var hasCurrentStage = visibleStages.some(function (s) { return s.visual === 'current'; });
    if (!hasCurrentStage) {
      for (var vi = 0; vi < visibleStages.length; vi++) {
        if (visibleStages[vi].visual === 'pending') {
          visibleStages[vi] = Object.assign({}, visibleStages[vi], { visual: 'current' });
          break;
        }
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
      noStages.textContent = 'No tracked review pipeline';
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

    if (plan.generatedBy) {
      const generatedBy = document.createElement('span');
      generatedBy.textContent = 'From ' + plan.generatedBy;
      meta.appendChild(generatedBy);
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
