'use strict';
(() => {
  const app = document.getElementById('app');
  const toasts = document.getElementById('avisos-toast');

  const state = {
    usuario: null,
    avisos: [],
    aba: 'entrar',               // entrar | criar
    filtro: 'novo',              // novo | visto | concluido | todos
    origem: '',
    busca: '',
    vistos: null,                // ids ja conhecidos pela portaria (para detectar chegadas)
    recentes: new Set(),
    timer: null,
  };
  let ui = {}; // referencias a elementos que mudam sem redesenhar a tela inteira
  let versaoAvisos = 0;

  const PRIORIDADE = { informativo: 'Informativo', normal: 'Normal', urgente: 'Urgente' };
  const PESO = { urgente: 3, normal: 2, informativo: 1 };

  // ---------- Utilitarios ----------
  // h('div', {class:'x', onclick: fn}, filhos...) -> elemento. Texto sempre entra como texto (sem XSS).
  function h(tag, props, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (['value', 'checked', 'disabled'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) {
      if (f == null || f === false) continue;
      el.append(f.nodeType ? f : document.createTextNode(String(f)));
    }
    return el;
  }

  async function api(caminho, opcoes = {}) {
    const init = { method: opcoes.method || 'GET', headers: {} };
    if (opcoes.corpo) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opcoes.corpo); }
    let resp;
    try { resp = await fetch(caminho, init); }
    catch { throw new Error('Sem conexão com o servidor. Verifique se ele está rodando.'); }
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) { const e = new Error(dados.erro || 'Algo deu errado.'); e.status = resp.status; throw e; }
    return dados;
  }

  function avisar(texto, tipo = '') {
    const t = h('div', { class: `toast ${tipo}`, role: tipo === 'erro-t' ? 'alert' : 'status' }, texto);
    toasts.append(t);
    setTimeout(() => t.remove(), 4500);
  }

  function alertarNoNavegador(aviso) {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const notificacao = new Notification(`Novo aviso: ${aviso.titulo}`, {
        body: `${aviso.autor}${aviso.horarioInicio || aviso.horarioFim ? ` · ${resumoHorario(aviso)}` : ''}`,
        tag: `fretar-${aviso.id}`,
      });
      notificacao.onclick = () => { window.focus(); notificacao.close(); };
    } catch {
      avisar('O navegador não conseguiu exibir a notificação.', 'erro-t');
    }
  }

  function resumoHorario(aviso) {
    if (aviso.horarioInicio && aviso.horarioFim) return `${aviso.horarioInicio} às ${aviso.horarioFim}`;
    if (aviso.horarioInicio) return `A partir de ${aviso.horarioInicio}`;
    return `Até ${aviso.horarioFim}`;
  }

  function tempo(iso) {
    const seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seg < 60) return 'agora mesmo';
    if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
    if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  const dataCompleta = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });

  function rotuloStatus(papel, status) {
    if (papel === 'notificante') return { novo: 'Enviado, aguardando a portaria', visto: 'Visto pela portaria', concluido: 'Concluído' }[status];
    return { novo: 'Novo', visto: 'Visto', concluido: 'Concluído' }[status];
  }

  // ---------- Entrada (login / cadastro) ----------
  function telaEntrada() {
    clearInterval(state.timer);
    document.title = 'Fretar · Mural de avisos';
    const criando = state.aba === 'criar';

    const erro = h('p', { class: 'erro', role: 'alert' });
    const login = h('input', { class: 'entrada-texto', id: 'login', name: 'login', type: 'text', required: true, maxlength: 40, autocomplete: 'username', autocapitalize: 'none', spellcheck: false });
    const senha = h('input', { class: 'entrada-texto', id: 'senha', name: 'password', type: 'password', required: true, minlength: criando ? 6 : null, maxlength: 72, autocomplete: criando ? 'new-password' : 'current-password', spellcheck: false });
    const senha2 = criando ? h('input', { class: 'entrada-texto', id: 'senha2', name: 'password-confirmation', type: 'password', required: true, maxlength: 72, autocomplete: 'new-password', spellcheck: false }) : null;

    function campoSenha(input) {
      const botaoVisualizar = h('button', {
        class: 'botao-senha',
        type: 'button',
        'aria-label': 'Mostrar senha',
        'aria-pressed': 'false',
        onclick: () => {
          const mostrando = input.type === 'text';
          input.type = mostrando ? 'password' : 'text';
          botaoVisualizar.textContent = mostrando ? 'Mostrar' : 'Ocultar';
          botaoVisualizar.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
          botaoVisualizar.setAttribute('aria-pressed', mostrando ? 'false' : 'true');
        },
      }, 'Mostrar');
      return h('div', { class: 'campo-senha' }, input, botaoVisualizar);
    }

    const botao = h('button', { class: 'btn btn-grande', type: 'submit' }, criando ? 'Criar conta' : 'Entrar');

    const form = h('form', {
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        erro.textContent = '';
        if (!login.value.trim() || !senha.value) { erro.textContent = 'Preencha o login e a senha.'; return; }
        if (criando && senha.value !== senha2.value) { erro.textContent = 'As senhas não são iguais.'; return; }
        botao.disabled = true;
        try {
          const d = await api(criando ? '/api/register' : '/api/login', { method: 'POST', corpo: { login: login.value.trim(), password: senha.value } });
          state.usuario = d.usuario;
          state.vistos = null;
          await entrarNoApp();
        } catch (e) { erro.textContent = e.message; botao.disabled = false; }
      },
    },
      h('div', { class: 'campo' },
        h('label', { for: 'login' }, criando ? 'Nome de login (seu setor ou local)' : 'Login'),
        login,
        criando && h('span', { class: 'dica' }, 'A portaria vê esse nome em cada aviso. Use algo que indique o local, como “Almoxarifado Bloco B”.')),
      h('div', { class: 'campo' }, h('label', { for: 'senha' }, 'Senha'), campoSenha(senha),
        criando && h('span', { class: 'dica' }, 'Mínimo de 6 caracteres.')),
      criando && h('div', { class: 'campo' }, h('label', { for: 'senha2' }, 'Repita a senha'), campoSenha(senha2)),
      erro, botao);

    const aba = (id, texto) => h('button', {
      class: 'aba', type: 'button', role: 'tab', 'aria-selected': String(state.aba === id),
      onclick: () => { state.aba = id; telaEntrada(); },
    }, texto);

    app.replaceChildren(h('main', { class: 'entrada' },
      h('section', { class: 'entrada-marca' },
        h('img', { src: '/img/fretar-logo.png', alt: 'Fretar', width: 170, height: 170 }),
        h('div', null, h('h1', null, 'Fretar'), h('p', { class: 'lema' }, 'O mural de avisos entre os setores e a portaria.')),
        h('div', { class: 'papeis' },
          h('p', null, h('strong', null, 'Quem avisa'), 'Crie uma conta com o nome do seu setor e deixe seus avisos no mural.'),
          h('p', null, h('strong', null, 'Quem recebe'), 'A portaria acompanha o mural, marca o que já viu e conclui o que foi resolvido.'))),
      h('section', { class: 'entrada-lado' },
        h('div', { class: 'entrada-card' },
          h('h2', null, criando ? 'Crie sua conta de notificante' : 'Entre no mural'),
          h('p', { class: 'sub' }, criando ? 'Leva menos de um minuto.' : 'Notificantes e portaria entram por aqui.'),
          h('div', { class: 'abas', role: 'tablist' }, aba('entrar', 'Entrar'), aba('criar', 'Criar conta')),
          form))));
    login.focus();
  }

  // ---------- Estrutura do app logado ----------
  function topo() {
    const u = state.usuario;
    return h('header', { class: 'topo' },
      h('div', { class: 'marca' },
        h('img', { src: '/img/fretar-logo.png', alt: '', width: 42, height: 42 }),
        h('span', { class: 'marca-nome' }, 'Fretar'),
        h('span', { class: 'marca-sub' }, 'Mural de avisos')),
      h('div', { class: 'usuario' },
        h('span', { class: `selo-papel selo-${u.role}` }, u.role === 'portaria' ? 'Recebedor' : 'Notificante'),
        h('span', { class: 'usuario-nome' }, u.login),
        h('button', { class: 'btn btn-claro', type: 'button', onclick: sair }, 'Sair')));
  }

  async function sair() {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* sai mesmo assim */ }
    state.usuario = null; state.avisos = []; state.vistos = null; state.aba = 'entrar';
    state.filtro = 'novo'; state.origem = ''; state.busca = ''; state.recentes = new Set();
    telaEntrada();
  }

  async function entrarNoApp() {
    await carregarAvisos();
    state.usuario.role === 'portaria' ? telaPortaria() : telaNotificante();
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (!document.hidden || (state.usuario && state.usuario.role === 'portaria')) atualizar();
    }, 10000);
  }

  async function carregarAvisos() {
    const versao = ++versaoAvisos;
    const { avisos } = await api('/api/avisos');
    if (versao !== versaoAvisos) return;
    if (state.usuario.role === 'portaria') {
      const ids = new Set(avisos.map((a) => a.id));
      if (state.vistos) {
        const chegadas = avisos.filter((a) => !state.vistos.has(a.id));
        state.recentes = new Set(chegadas.map((a) => a.id));
        if (chegadas.length) {
          avisar(chegadas.length === 1 ? `Novo aviso de ${chegadas[0].autor}` : `${chegadas.length} novos avisos no mural`, 'ok-t');
          chegadas.forEach(alertarNoNavegador);
        }
      }
      state.vistos = ids;
    }
    state.avisos = avisos;
  }

  async function atualizar() {
    try {
      await carregarAvisos();
      state.usuario.role === 'portaria' ? desenharMural() : desenharMeusAvisos();
    } catch (e) {
      if (e.status === 401) {
        state.usuario = null;
        state.filtro = 'novo'; state.origem = ''; state.busca = ''; state.recentes = new Set();
        telaEntrada();
        avisar('Sua sessão terminou. Entre novamente.', 'erro-t');
      }
    }
  }

  // ---------- Cartao de aviso ----------
  function cartao(aviso, acoes) {
    const papel = state.usuario.role;
    return h('li', { class: `aviso p-${aviso.prioridade} ${aviso.status === 'concluido' ? 'concluido' : ''} ${state.recentes.has(aviso.id) ? 'recem' : ''}` },
      h('div', { class: 'aviso-topo' },
        papel === 'portaria' && h('span', { class: 'origem' }, aviso.autor),
        h('span', { class: 'etiqueta' }, PRIORIDADE[aviso.prioridade])),
      h('h3', null, aviso.titulo),
      h('p', { class: 'mensagem' }, aviso.mensagem),
      (aviso.horarioInicio || aviso.horarioFim) && h('p', { class: 'aviso-horario' },
        h('span', null, 'Horário necessário:'),
        h('strong', null, resumoHorario(aviso))),
      h('div', { class: 'aviso-rodape' },
        h('span', { class: 'tempo', title: dataCompleta(aviso.criadoEm) }, tempo(aviso.criadoEm)),
        h('span', { class: `status ${aviso.status}` }, rotuloStatus(papel, aviso.status))),
      acoes && acoes.length ? h('div', { class: 'acoes' }, acoes) : null);
  }

  // ---------- Notificante ----------
  function telaNotificante() {
    document.title = 'Fretar · Meus avisos';
    const erro = h('p', { class: 'erro', role: 'alert' });
    const titulo = h('input', { class: 'entrada-texto', id: 'titulo', type: 'text', maxlength: 80, required: true, placeholder: 'Ex.: Entrega de material' });
    const mensagem = h('textarea', { class: 'entrada-texto', id: 'mensagem', maxlength: 600, required: true, placeholder: 'Conte o que a portaria precisa saber ou fazer.' });
    const horarioInicio = h('input', { class: 'entrada-texto', id: 'horario-inicio', name: 'horarioInicio', type: 'time' });
    const horarioFim = h('input', { class: 'entrada-texto', id: 'horario-fim', name: 'horarioFim', type: 'time' });
    const contador = h('span', { class: 'dica contador' }, '0 / 600');
    mensagem.addEventListener('input', () => { contador.textContent = `${mensagem.value.length} / 600`; });
    const botao = h('button', { class: 'btn btn-grande', type: 'submit' }, 'Enviar aviso');

    const radio = (valor, checado) => h('label', { class: 'prioridade' },
      h('input', { type: 'radio', name: 'prioridade', value: valor, checked: checado }),
      h('span', { class: `p-${valor}` }, PRIORIDADE[valor]));

    const form = h('form', {
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        erro.textContent = '';
        if (titulo.value.trim().length < 3) { erro.textContent = 'Escreva um título com pelo menos 3 letras.'; titulo.focus(); return; }
        if (!mensagem.value.trim()) { erro.textContent = 'Escreva a mensagem do aviso.'; mensagem.focus(); return; }
        botao.disabled = true;
        try {
          await api('/api/avisos', { method: 'POST', corpo: {
            titulo: titulo.value, mensagem: mensagem.value,
            horarioInicio: horarioInicio.value, horarioFim: horarioFim.value,
            prioridade: form.elements.prioridade.value } });
          form.reset(); contador.textContent = '0 / 600';
          avisar('Aviso enviado para a portaria.', 'ok-t');
          await atualizar();
        } catch (e) { erro.textContent = e.message; }
        botao.disabled = false;
      },
    },
      h('div', { class: 'campo' }, h('label', { for: 'titulo' }, 'Título'), titulo),
      h('div', { class: 'campo' }, h('label', { for: 'mensagem' }, 'Mensagem'), mensagem, contador),
      h('fieldset', { class: 'horarios' },
        h('legend', null, 'Horário necessário (opcional)'),
        h('p', { class: 'dica' }, 'Informe um horário ou um intervalo para a portaria se programar.'),
        h('div', { class: 'horarios-campos' },
          h('div', { class: 'campo' }, h('label', { for: 'horario-inicio' }, 'A partir das'), horarioInicio),
          h('div', { class: 'campo' }, h('label', { for: 'horario-fim' }, 'Até'), horarioFim))),
      h('fieldset', { class: 'prioridades' }, h('legend', null, 'Prioridade'),
        radio('informativo', false), radio('normal', true), radio('urgente', false)),
      erro, botao);

    ui.lista = h('ul', { class: 'mural' });
    app.replaceChildren(topo(), h('main', { class: 'principal' },
      h('div', { class: 'duas-colunas' },
        h('section', { class: 'painel fixo', 'aria-labelledby': 'h-novo' },
          h('h2', { id: 'h-novo' }, 'Novo aviso'),
          h('p', { class: 'sub' }, `Será enviado como “${state.usuario.login}”.`),
          form),
        h('section', { 'aria-labelledby': 'h-meus' },
          h('h2', { id: 'h-meus' }, 'Seus avisos'),
          h('p', { class: 'sub' }, 'Acompanhe aqui quando a portaria vir e concluir cada aviso.'),
          ui.lista))));
    desenharMeusAvisos();
  }

  function desenharMeusAvisos() {
    if (!ui.lista || !ui.lista.isConnected) return;
    if (!state.avisos.length) {
      ui.lista.replaceChildren(h('li', { class: 'vazio' }, h('strong', null, 'Nenhum aviso enviado ainda'), 'Preencha o formulário para deixar seu primeiro aviso na portaria.'));
      return;
    }
    ui.lista.replaceChildren(...state.avisos.map((a) => cartao(a,
      [h('button', { class: 'btn btn-perigo', type: 'button', onclick: () => apagar(a) }, 'Apagar aviso')])));
  }

  async function apagar(aviso) {
    const origem = state.usuario.role === 'portaria' ? ` de ${aviso.autor}` : '';
    if (!confirm(`Apagar o aviso “${aviso.titulo}”${origem}?`)) return;
    try {
      await api(`/api/avisos/${aviso.id}`, { method: 'DELETE' });
      versaoAvisos++;
      state.avisos = state.avisos.filter((item) => item.id !== aviso.id);
      avisar('Aviso apagado.', 'ok-t');
      state.usuario.role === 'portaria' ? desenharMural() : desenharMeusAvisos();
    }
    catch (e) { avisar(e.message, 'erro-t'); }
  }

  // ---------- Portaria (recebedor) ----------
  function controleAlertas() {
    if (!('Notification' in window)) {
      return h('span', { class: 'alertas-estado' }, 'Alertas do navegador indisponíveis');
    }
    if (Notification.permission === 'granted') {
      return h('span', { class: 'alertas-estado ativo', role: 'status' }, 'Alertas do navegador ativados');
    }
    if (Notification.permission === 'denied') {
      return h('span', { class: 'alertas-estado' }, 'Alertas bloqueados nas configurações do navegador');
    }
    return h('button', {
      class: 'btn btn-alerta',
      type: 'button',
      onclick: async () => {
        try {
          const permissao = await Notification.requestPermission();
          ui.alertas.replaceChildren(controleAlertas());
          avisar(permissao === 'granted'
            ? 'Alertas ativados. Deixe o Fretar aberto para receber notificações.'
            : 'Permita as notificações do Fretar nas configurações do navegador.', permissao === 'granted' ? 'ok-t' : 'erro-t');
        } catch {
          avisar('Não foi possível ativar as notificações do navegador.', 'erro-t');
        }
      },
    }, 'Ativar alertas');
  }

  function telaPortaria() {
    ui.filtros = h('div', { class: 'filtros', role: 'group', 'aria-label': 'Filtrar por andamento' });
    ui.origem = h('select', { class: 'entrada-texto', 'aria-label': 'Filtrar por origem', onchange: (e) => { state.origem = e.target.value; desenharMural(); } });
    ui.busca = h('input', { class: 'entrada-texto', type: 'search', name: 'busca', autocomplete: 'off', placeholder: 'Buscar nos avisos', 'aria-label': 'Buscar nos avisos', value: state.busca,
      oninput: (e) => { state.busca = e.target.value; desenharMural(); } });
    ui.alertas = h('div', { class: 'alertas-controle' }, controleAlertas());
    ui.lista = h('ul', { class: 'mural' });
    app.replaceChildren(topo(), h('main', { class: 'principal' },
      h('div', { class: 'mural-cabecalho' },
        h('div', null,
          h('h2', null, 'Mural da portaria'),
          h('p', { class: 'sub' }, 'Todos os avisos enviados pelos setores. A lista atualiza sozinha.')),
        ui.alertas),
      h('div', { class: 'barra' }, ui.filtros, h('span', { class: 'espaco' }), ui.origem, ui.busca),
      ui.lista));
    desenharMural();
  }

  const conta = (status) => state.avisos.filter((a) => status === 'todos' || a.status === status).length;

  function desenharMural() {
    if (!ui.lista || !ui.lista.isConnected) return;

    // Filtros com contagem
    const novos = conta('novo');
    ui.filtros.replaceChildren(...[['novo', 'Novos'], ['visto', 'Vistos'], ['concluido', 'Concluídos'], ['todos', 'Todos']].map(([id, nome]) =>
      h('button', { class: `filtro ${id === 'novo' && novos ? 'tem-novos' : ''}`, type: 'button', 'aria-pressed': String(state.filtro === id),
        onclick: () => { state.filtro = id; state.recentes = new Set(); desenharMural(); } },
        nome, h('span', { class: 'n' }, conta(id)))));
    document.title = novos ? `(${novos}) Fretar · Mural da portaria` : 'Fretar · Mural da portaria';

    // Lista de origens
    const origens = [...new Set(state.avisos.map((a) => a.autor))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (state.origem && !origens.includes(state.origem)) state.origem = '';
    ui.origem.replaceChildren(h('option', { value: '' }, 'Todas as origens'),
      ...origens.map((o) => h('option', { value: o, selected: o === state.origem }, o)));
    ui.origem.value = state.origem;

    // Avisos filtrados
    const termo = state.busca.trim().toLocaleLowerCase('pt-BR');
    const visiveis = state.avisos
      .filter((a) => state.filtro === 'todos' || a.status === state.filtro)
      .filter((a) => !state.origem || a.autor === state.origem)
      .filter((a) => !termo || `${a.titulo} ${a.mensagem} ${a.autor}`.toLocaleLowerCase('pt-BR').includes(termo))
      .sort((a, b) => (PESO[b.prioridade] - PESO[a.prioridade]) || b.criadoEm.localeCompare(a.criadoEm));

    if (!visiveis.length) {
      const vazio = state.avisos.length === 0
        ? ['O mural está vazio', 'Quando um setor enviar um aviso, ele aparece aqui.']
        : state.filtro === 'novo' && !termo && !state.origem
          ? ['Nenhum aviso novo', 'Tudo que chegou já foi visto. Veja a aba “Vistos” para o que está em andamento.']
          : ['Nenhum aviso encontrado', 'Mude o filtro ou a busca para ver outros avisos.'];
      ui.lista.replaceChildren(h('li', { class: 'vazio' }, h('strong', null, vazio[0]), vazio[1]));
      return;
    }
    ui.lista.replaceChildren(...visiveis.map((a) => cartao(a, acoesPortaria(a))));
  }

  function acoesPortaria(a) {
    const mudar = (status, msg) => async (event) => {
      const botao = event.currentTarget;
      botao.disabled = true;
      try {
        const { aviso: atualizado } = await api(`/api/avisos/${a.id}`, { method: 'PATCH', corpo: { status } });
        versaoAvisos++;
        state.avisos = state.avisos.map((item) => item.id === atualizado.id ? atualizado : item);
        state.filtro = 'todos';
        state.recentes.delete(a.id);
        avisar(msg, 'ok-t');
        desenharMural();
      }
      catch (e) { avisar(e.message, 'erro-t'); }
      finally { botao.disabled = false; }
    };
    const btn = (classe, texto, fn) => h('button', { class: `btn ${classe}`, type: 'button', onclick: fn }, texto);
    const apagarBotao = btn('btn-perigo', 'Apagar', () => apagar(a));
    if (a.status === 'novo') return [btn('', 'Marcar como visto', mudar('visto', 'Marcado como visto.')), btn('btn-verde', 'Concluir', mudar('concluido', 'Aviso concluído.')), apagarBotao];
    if (a.status === 'visto') return [btn('btn-verde', 'Concluir', mudar('concluido', 'Aviso concluído.')), btn('btn-claro', 'Voltar para novo', mudar('novo', 'Aviso voltou para novos.')), apagarBotao];
    return [btn('btn-claro', 'Reabrir', mudar('visto', 'Aviso reaberto.')),
      apagarBotao];
  }

  // ---------- Inicio ----------
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.usuario) atualizar(); });

  (async () => {
    try {
      const { usuario } = await api('/api/me');
      state.usuario = usuario;
      await entrarNoApp();
    } catch {
      telaEntrada();
    }
  })();
})();
