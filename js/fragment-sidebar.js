/*!
 * fragment-sidebar.js — pengelola data URL fragment (#d=...) dalam sidebar.
 * Vanilla JS, tanpa dependensi. CSS di-inject otomatis (prefix .fsb-).
 *
 * Pakai:
 *   <script src="fragment-sidebar.js"></script>
 *   <script>FragmentSidebar.init();</script>
 *
 * Yang disimpan hanya fragment (mis. "d=N4Ig..."), TANPA hostname/path,
 * jadi data sama bisa dipakai di localhost maupun github.io.
 * Catatan: localStorage terikat origin; pindah host => pakai Export/Import.
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    storageKey: 'text-pipeline-collection.v1',      // kunci localStorage
    openKey: 'text-pipeline-collection.open',       // kunci status buka/tutup sidebar
    title: 'Saved Pipelines',
    mount: document.body,            // elemen tempat sidebar dipasang
    reloadOnApply: false,            // true jika app kamu hanya membaca hash saat load
    toggleMount: null,   // selector/elemen, mis. '.topbar-inner'. null = tombol melayang di kiri atas
    // --- Titik integrasi: ubah agar cocok dengan kode kamu ---
    getMainState: () => {},
    decodeUrl: () => {},
    getFragment: () => location.hash.replace(/^#d=/g, ''),
    applyFragment: (frag) => {
      // default: set hash; event "hashchange" akan terpicu jika berbeda
      const newUrl = window.location.pathname + window.location.search + '#d=' + frag;
      history.replaceState({}, '', newUrl);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      // if (location.hash.replace(/^#/, '') === frag) {
      //   window.dispatchEvent(new HashChangeEvent('hashchange'));
      // } else {
      //   location.hash = frag;
      // }
    },
    onChange: null,                  // callback (sidebarState) setiap data berubah
  };

  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

  // Ambil fragment dari teks: bisa "#d=..", "d=..", atau URL lengkap (hostname dibuang)
  function toFragment(text) {
    text = String(text || '').trim();
    const iHash = text.indexOf('#d=');
    const iQuery = text.indexOf('?d=');
    console.log (iHash);
    console.log (iQuery);
    if (iHash >= 0)
      return text.slice(iHash + 3).trim();
    else if (iQuery >= 0)
      return text.slice(iQuery + 3).trim();
    else
      return text.trim();
  }

  const ICONS = {
    save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8',
    folderPlus: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z M12 10v6 M9 13h6',
    link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    fileUp: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6 M9 15l3-3 3 3',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
    x: 'M18 6 6 18 M6 6l12 12',
    pencil: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
    trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5',
    plus: 'M5 12h14 M12 5v14',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
  };
  const icon = (n) =>
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;


  function create(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});

    // ---------- State & storage ----------
    let sidebarState = load();
    const collapsed = new Set();
    let selectedFolder = null; // folder tujuan untuk item baru

    function load() {
      try {
        const s = JSON.parse(localStorage.getItem(o.storageKey));
        if (s && Array.isArray(s.folders) && Array.isArray(s.items)) return s;
      } catch (e) { /* abaikan */ }
      return { format: 'text-pipeline-collection', version: 1, folders: [], items: [] };
    }
    function save() {
      try { localStorage.setItem(o.storageKey, JSON.stringify(sidebarState)); }
      catch (e) { showToast('Gagal menyimpan: localStorage penuh atau diblokir'); }
      if (o.onChange) o.onChange(sidebarState);
      render();
    }

    // ---------- DOM ----------
    // const style = document.createElement('style');
    // style.textContent = CSS;
    // document.head.appendChild(style);

    const root = document.createElement('aside');
    root.className = 'fsb';
    root.setAttribute('aria-label', o.title);
    root.innerHTML = `
      <div class="fsb-head"><h3></h3><button class="fsb-ico" data-role="close" title="Tutup" aria-label="Tutup">${icon('x')}</button></div>
      <div class="fsb-bar">
        <button class="fsb-primary" data-role="save" title="Simpan data yang sedang terbuka">${icon('save')}Simpan</button>
        <span class="fsb-sep"></span>
        <button class="fsb-ico" data-role="folder" title="Folder baru" aria-label="Folder baru">${icon('folderPlus')}</button>
        <button class="fsb-ico" data-role="paste" title="Tempel URL" aria-label="Tempel URL">${icon('link')}</button>
        <button class="fsb-ico" data-role="openfile" title="Buka file" aria-label="Buka file">${icon('fileUp')}</button>
        <button class="fsb-ico" data-role="import" title="Import backup" aria-label="Import backup">${icon('upload')}</button>
        <button class="fsb-ico" data-role="export" title="Export backup" aria-label="Export backup">${icon('download')}</button>
      </div>
      <div class="fsb-cur" title=""></div>
      <div class="fsb-tree"></div>
      <div class="fsb-foot">Seret untuk memindahkan.</div>
      <div class="fsb-showToast"></div>`;
    root.querySelector('h3').textContent = o.title;
    const tree = root.querySelector('.fsb-tree');
    const curEl = root.querySelector('.fsb-cur');
    const showToastEl = root.querySelector('.fsb-showToast');
    const fileIn = document.createElement('input');
    fileIn.type = 'file';
    fileIn.hidden = true;
    root.appendChild(fileIn);

    const toggle = document.createElement('button');
    toggle.className = 'fsb-toggle';
    toggle.innerHTML = icon('menu');
    toggle.title = 'Saved Pipeline';
    toggle.setAttribute('aria-label', 'Buka sidebar data');

    o.mount.appendChild(root);
    const tm = typeof o.toggleMount === 'string' ? document.querySelector(o.toggleMount) : o.toggleMount;
    if (tm) toggle.classList.add('inline');
    (tm || o.mount).appendChild(toggle);

    function setOpen(v) {
      root.classList.toggle('open', v);
      toggle.style.visibility = v ? 'hidden' : '';
      try { localStorage.setItem(o.openKey, v ? '1' : '0'); } catch (e) { }
    }
    toggle.onclick = () => setOpen(true);
    setOpen(localStorage.getItem(o.openKey) === '1');

    let showToastTimer;
    function showToast(msg) {
      o.showToast(msg);
    }

    // ---------- Operasi data ----------
    const folderById = (id) => sidebarState.folders.find((f) => f.id === id);
    const download = (name, text, type) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const safeName = (s) => String(s).replace(/[^\w\- ]+/g, '_').trim() || 'data';

    function addItem(name, fragment, folderId) {
      const item = { id: uid(), name, fragment, folderId: folderId || null, updatedAt: Date.now() };
      sidebarState.items.push(item);
      save();
      return item;
    }
    function applyItem(item) {
      const frag = o.getFragment();
      const matchedItem = sidebarState.items.find((x) => x.fragment === frag);
      if (!matchedItem) {
        if (confirm("Discard current pipeline and load selected?"))
          o.applyFragment(item.fragment);
      } else
        o.applyFragment(item.fragment);
      // o.loadData();
      // if (o.reloadOnApply) location.reload();
      // else render();
    }
    function isDescendant(folderId, ancestorId) {
      for (let f = folderById(folderId); f; f = folderById(f.parentId)) {
        if (f.id === ancestorId) return true;
      }
      return false;
    }
    function removeFolder(id) {
      const f = folderById(id);
      if (!f) return;
      if (!confirm(`Hapus folder "${f.name}"? Isinya dipindah ke level di atasnya.`)) return;
      sidebarState.folders.forEach((x) => { if (x.parentId === id) x.parentId = f.parentId || null; });
      sidebarState.items.forEach((x) => { if (x.folderId === id) x.folderId = f.parentId || null; });
      sidebarState.folders = sidebarState.folders.filter((x) => x.id !== id);
      if (selectedFolder === id) selectedFolder = null;
      save();
    }

    // ---------- Render ----------
    function render() {
      const cur = o.getFragment();
      curEl.textContent = cur ? '#d=' + cur : '(fragment kosong)';
      curEl.title = cur ? '#' + cur : '';
      tree.textContent = '';
      if (!sidebarState.items.length && !sidebarState.folders.length) {
        const e = document.createElement('div');
        e.className = 'fsb-empty';
        e.textContent = 'Belum ada data tersimpan. Klik "Simpan saat ini" untuk menyimpan pipeline yang sedang terbuka.';
        tree.appendChild(e);
        return;
      }
      tree.appendChild(renderLevel(null));
      // zona drop untuk kembali ke root
      tree.ondragover = (e) => { if (e.target === tree) e.preventDefault(); };
      tree.ondrop = (e) => { if (e.target === tree) dropOn(e, null); };
    }

    function renderLevel(parentId) {
      const frag = document.createDocumentFragment();
      const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
      sidebarState.folders.filter((f) => (f.parentId || null) === parentId).sort(byName).forEach((f) => frag.appendChild(renderFolder(f)));
      sidebarState.items.filter((i) => (i.folderId || null) === parentId).sort(byName).forEach((i) => frag.appendChild(renderItem(i)));
      return frag;
    }

    function actBtn(name, title, fn, cls) {
      const b = document.createElement('button');
      b.innerHTML = icon(name); b.title = title; b.setAttribute('aria-label', title);
      if (cls) b.className = cls;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    }

    function renderFolder(f) {
      const wrap = document.createElement('div');
      wrap.className = 'fsb-folder';
      const row = document.createElement('div');
      row.className = 'fsb-row' + (selectedFolder === f.id ? ' active' : '');
      row.draggable = true;
      const open = !collapsed.has(f.id);
      const name = document.createElement('span');
      name.className = 'fsb-name';
      name.textContent = (open ? '▾ ' : '▸ ') + f.name;
      const acts = document.createElement('span');
      acts.className = 'fsb-acts';
      acts.append(
        actBtn('pencil', 'Ganti nama', () => { const n = prompt('Nama folder:', f.name); if (n && n.trim()) { f.name = n.trim(); save(); } }),
        actBtn('plus', 'Subfolder', () => newFolder(f.id)),
        actBtn('trash', 'Hapus', () => removeFolder(f.id), 'del')
      );
      row.append(name, acts);
      row.onclick = () => {
        selectedFolder = selectedFolder === f.id ? null : f.id;
        if (collapsed.has(f.id)) collapsed.delete(f.id); else collapsed.add(f.id);
        render();
      };
      wireDrag(row, 'folder', f.id, f.id);
      wrap.appendChild(row);
      if (open) {
        const kids = document.createElement('div');
        kids.className = 'fsb-kids';
        kids.appendChild(renderLevel(f.id));
        wrap.appendChild(kids);
      }
      return wrap;
    }

    function renderItem(it) {
      const row = document.createElement('div');
      const active = it.fragment === o.getFragment();
      row.className = 'fsb-row' + (active ? ' active' : '');
      row.draggable = true;
      row.tabIndex = 0;
      row.title = '#' + it.fragment.slice(0, 120);
      row.dataset.id = it.id;
      const name = document.createElement('span');
      name.className = 'fsb-name';
      name.textContent = it.name;
      const acts = document.createElement('span');
      acts.className = 'fsb-acts';
      acts.append(
        actBtn('refresh', 'Timpa dengan data saat ini', () => {
          if (!confirm(`Timpa "${it.name}" dengan data yang sedang terbuka?`)) return;
          it.fragment = o.getFragment(); it.updatedAt = Date.now(); save(); showToast('Diperbarui');
        }),
        actBtn('download', 'Simpan ke file', () => download(safeName(it.name) + '.txt', '#' + it.fragment)),
        actBtn('pencil', 'Ganti nama', () => { const n = prompt('Nama:', it.name); if (n && n.trim()) { it.name = n.trim(); save(); } }),
        actBtn('trash', 'Hapus', () => { if (confirm(`Hapus "${it.name}"?`)) { sidebarState.items = sidebarState.items.filter((x) => x !== it); save(); } }, 'del')
      );
      row.append(name, acts);
      row.onclick = () => applyItem(it);
      row.onkeydown = (e) => { if (e.key === 'Enter') applyItem(it); };
      wireDrag(row, 'item', it.id, null);
      return row;
    }

    // ---------- Drag & drop ----------
    function wireDrag(row, kind, id, dropFolderId) {
      row.ondragstart = (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/fsb', kind + ':' + id);
        e.dataTransfer.effectAllowed = 'move';
      };
      if (dropFolderId) {
        row.ondragover = (e) => { e.preventDefault(); row.classList.add('over'); };
        row.ondragleave = () => row.classList.remove('over');
        row.ondrop = (e) => { e.stopPropagation(); row.classList.remove('over'); dropOn(e, dropFolderId); };
      }
    }
    function dropOn(e, folderId) {
      e.preventDefault();
      const [kind, id] = (e.dataTransfer.getData('text/fsb') || ':').split(':');
      if (kind === 'item') {
        const it = sidebarState.items.find((x) => x.id === id);
        if (it) { it.folderId = folderId; save(); }
      } else if (kind === 'folder' && id !== folderId) {
        if (folderId && isDescendant(folderId, id)) return showToast('Tidak bisa memindahkan folder ke dalam dirinya');
        const f = folderById(id);
        if (f) { f.parentId = folderId; save(); }
      }
    }

    // ---------- Aksi tombol ----------
    function newFolder(parentId) {
      const n = prompt('Nama folder:');
      if (!n || !n.trim()) return;
      const f = { id: uid(), name: n.trim(), parentId: parentId || null };
      sidebarState.folders.push(f);
      collapsed.delete(f.id);
      save();
    }

    function saveCurrent() {
      const frag = o.getFragment();
      if (!frag) return showToast('Empty fragment, no saved data');
      const dup = sidebarState.items.find((i) => i.fragment === frag);
      if (dup && !confirm(`Data ini sudah tersimpan sebagai "${dup.name}". Simpan salinan?`)) return;
      const n = prompt('Nama data:', o.getMainState()?.title);
      if (!n || !n.trim()) return;
      addItem(n.trim(), frag, selectedFolder);
      showToast('Tersimpan');
    }

    function pasteUrl() {
      const t = prompt('Paste complete URL or fragment (hostname will be ignored):');
      const frag = toFragment(t);
      if (!frag) return;  
      let parsedMainState = o.decodeUrl(frag);
      if (!parsedMainState) // if failed try to decode it first
        parsedMainState = o.decodeUrl(decodeURIComponent(frag));
      const n = prompt('Nama data:', parsedMainState?.title);
      if (!n || !n.trim()) return;
      applyItem(addItem(n.trim(), frag, selectedFolder));
    }

    function exportAll() {
      download('text-pipeline-collection-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(sidebarState, null, 2), 'application/json');
    }

    // Gabungkan backup ke sidebarState saat ini, id di-remap agar tidak bentrok
    function mergeBackup(data, replace) {
      if (replace) sidebarState = { format: 'text-pipeline-collection', version: 1, folders: [], items: [] };
      const map = {};
      data.folders.forEach((f) => { map[f.id] = uid(); });
      data.folders.forEach((f) => sidebarState.folders.push({ id: map[f.id], name: String(f.name), parentId: map[f.parentId] || null }));
      data.items.forEach((i) => sidebarState.items.push({
        id: uid(), name: String(i.name), fragment: toFragment(i.fragment),
        folderId: map[i.folderId] || null, updatedAt: i.updatedAt || Date.now(),
      }));
      save();
    }

    let fileMode = 'import';
    function pickFile(mode, accept) {
      fileMode = mode;
      fileIn.accept = accept || '';
      fileIn.value = '';
      fileIn.click();
    }
    fileIn.onchange = async () => {
      const file = fileIn.files[0];
      if (!file) return;
      const text = await file.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { /* bukan JSON: perlakukan sebagai fragment */ }
      if (data && data.format === 'text-pipeline-collection' && Array.isArray(data.items) && Array.isArray(data.folders)) {
        const replace = confirm('Import backup.\nOK = ganti semua data saat ini\nBatal = gabungkan dengan data saat ini');
        mergeBackup(data, replace);
        showToast(`Diimpor: ${data.items.length} item, ${data.folders.length} folder`);
        return;
      }
      // file teks biasa = sumber fragment (isi file: "#d=..." / "d=..." / URL)
      const frag = toFragment(text.split(/\r?\n/)[0] === '' ? text : text);
      if (!frag) return showToast('File kosong atau tidak dikenali');
      const item = addItem(file.name.replace(/\.[^.]+$/, ''), frag, selectedFolder);
      applyItem(item);
      showToast('File dimuat sebagai sumber data');
    };

    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-role]');
      if (!a) return;
      ({
        close: () => setOpen(false),
        save: saveCurrent,
        folder: () => newFolder(selectedFolder),
        paste: pasteUrl,
        openfile: () => pickFile('open', '.txt,.url,.json,text/plain'),
        import: () => pickFile('import', '.json,.txt'),
        export: exportAll,
      })[a.dataset.role]();
    });

    window.addEventListener('hashchange', render);
    window.addEventListener('hashchange', updateActiveItem);
    render();

    function updateActiveItem() {
      const currentlyActiveRow = root.querySelector(`.fsb-row.active`);
      const frag = o.getFragment();
      const item = sidebarState.items.find((i) => i.fragment === frag);
      if (currentlyActiveRow)
        currentlyActiveRow.classList.toggle("active", false);
      if (!item) return;
      const activeRow = root.querySelector(`.fsb-row[data-id="${item.id}"]`);
      if (activeRow)
        activeRow.classList.toggle("active", true);

    }

    function findSavedByFragment(frag) {
      return sidebarState.items.find((x) => x.fragment === frag);
    }


    return {
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen(!root.classList.contains('open')),
      refresh: render,
      getState: () => JSON.parse(JSON.stringify(sidebarState)),
      addItem, exportAll,
      updateActiveItem: updateActiveItem,
      findSavedByFragment: findSavedByFragment,
    };
  }

  
  global.FragmentSidebar = { init: create };
})(window);
