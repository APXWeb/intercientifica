(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Menu
  const header = document.getElementById('site-header');
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('nav-toggle');

  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  }
  navToggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setMenu(false);
      navToggle.focus();
    }
  });
  document.addEventListener('click', e => {
    if (nav.classList.contains('is-open') && !header.contains(e.target)) setMenu(false);
  });

  // Header e botão de topo
  const toTop = document.getElementById('to-top');
  let ticking = false;
  function onScroll() {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 8);
    toTop.classList.toggle('is-visible', y > 1000);
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();
  toTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    document.querySelector('.brand').focus({ preventScroll: true });
  });

  // Link ativo no menu
  const navLinks = [...nav.querySelectorAll('a[href^="#"]')];
  const observed = [...new Set(navLinks.map(a => a.getAttribute('href')))]
    .map(id => document.querySelector(id)).filter(Boolean);
  observed.push(document.getElementById('inicio'));
  if ('IntersectionObserver' in window) {
    const activeObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        navLinks.forEach(a => {
          const active = a.getAttribute('href') === `#${entry.target.id}`;
          a.classList.toggle('is-active', active);
          if (active) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    observed.forEach(s => activeObserver.observe(s));
  }

  // Números animados
  const fmt = new Intl.NumberFormat('pt-BR');
  function countUp(el) {
    const target = Number(el.dataset.count);
    if (reducedMotion) { el.textContent = fmt.format(target); return; }
    const duration = 1600;
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = fmt.format(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Revelação ao rolar
  const revealEls = document.querySelectorAll('.reveal, .reveal-img');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(el => el.classList.add('is-in'));
  } else {
    const revealObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        entry.target.querySelectorAll('[data-count]').forEach(countUp);
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(el => revealObserver.observe(el));
  }

  function markReady() { requestAnimationFrame(() => document.body.classList.add('is-ready')); }
  if (document.readyState === 'complete') markReady();
  else window.addEventListener('load', markReady);
  setTimeout(markReady, 1500);

  // Filtro de produtos
  const filters = [...document.querySelectorAll('.filter')];
  const products = [...document.querySelectorAll('.product')];
  const filterStatus = document.getElementById('filter-status');
  const lineNames = { todos: 'todas as linhas', neomap: 'linha NeoMAP®', neolisa: 'linha NeoLISA®' };

  function applyFilter(value) {
    let shown = 0;
    filters.forEach(btn => {
      const active = btn.dataset.filter === value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    products.forEach(p => {
      const visible = value === 'todos' || p.dataset.line === value;
      p.hidden = !visible;
      if (visible) {
        shown++;
        p.classList.add('is-in');
      }
    });
    filterStatus.textContent = `${shown} produtos da ${lineNames[value]}`;
  }
  filters.forEach(btn => btn.addEventListener('click', () => applyFilter(btn.dataset.filter)));
  document.querySelectorAll('[data-goto-filter]').forEach(link => {
    link.addEventListener('click', () => applyFilter(link.dataset.gotoFilter));
  });

  // Formulário: validação e envio pelo aplicativo de e-mail
  const form = document.getElementById('contact-form');
  const status = document.getElementById('form-status');
  const rules = {
    nome: v => v.trim().length >= 2 || 'Informe seu nome.',
    email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Informe um e-mail válido, como nome@laboratorio.com.br.',
    assunto: v => v !== '' || 'Escolha o assunto da mensagem.',
    mensagem: v => v.trim().length >= 10 || 'Escreva sua mensagem com pelo menos 10 caracteres.'
  };
  const errorIds = { nome: 'e-nome', email: 'e-email', assunto: 'e-assunto', mensagem: 'e-msg' };

  function validateField(name) {
    const input = form.elements[name];
    const result = rules[name](input.value);
    const field = input.closest('.field');
    const errorEl = document.getElementById(errorIds[name]);
    const ok = result === true;
    field.classList.toggle('has-error', !ok);
    input.setAttribute('aria-invalid', String(!ok));
    errorEl.textContent = ok ? '' : result;
    // Quando o último erro é corrigido, o aviso geral some junto.
    if (ok && status.classList.contains('is-error') && !form.querySelector('.field.has-error')) {
      status.textContent = '';
      status.className = 'form-status';
    }
    return ok;
  }

  Object.keys(rules).forEach(name => {
    const input = form.elements[name];
    input.addEventListener('blur', () => { if (input.value !== '') validateField(name); });
    input.addEventListener('input', () => { if (input.closest('.field').classList.contains('has-error')) validateField(name); });
    input.addEventListener('change', () => { if (input.closest('.field').classList.contains('has-error')) validateField(name); });
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const invalid = Object.keys(rules).filter(name => !validateField(name));
    if (invalid.length) {
      status.className = 'form-status is-error';
      status.textContent = invalid.length === 1 ? 'Corrija o campo destacado.' : `Corrija os ${invalid.length} campos destacados.`;
      form.elements[invalid[0]].focus();
      return;
    }
    const data = new FormData(form);
    const subject = `[Site] ${data.get('assunto')}`;
    const body = [
      `Nome: ${data.get('nome')}`,
      `Laboratório ou instituição: ${data.get('empresa') || 'não informado'}`,
      `E-mail: ${data.get('email')}`,
      `Telefone: ${data.get('telefone') || 'não informado'}`,
      '',
      data.get('mensagem')
    ].join('\n');
    window.location.href = `mailto:ic@intercientifica.com.br?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.className = 'form-status is-success';
    status.textContent = 'Abrimos o seu aplicativo de e-mail com a mensagem pronta. Basta enviar por lá.';
  });
})();
