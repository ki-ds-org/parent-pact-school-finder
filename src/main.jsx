import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.scss';

const norm = (value = '') => String(value)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('sv-SE').trim();

const slugify = (value = '') => norm(value)
  .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const getName = (m) => m.municipality ?? m.name ?? m.kommun ?? '';
const getSchoolName = (s) => s.school ?? s.name ?? s.schoolName ?? s.school_name ?? '';

function getCount(s, keys) {
  for (const key of keys) {
    const value = s?.[key];
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function normalizePayload(payload) {
  const municipalities = Array.isArray(payload)
    ? payload
    : (payload?.data ?? payload?.municipalities ?? payload?.results ?? payload?.result);
  if (!Array.isArray(municipalities)) {
    throw new Error('API-svaret har inte förväntat format. Förväntar en lista med kommuner och skolor.');
  }

  const normalizedMunicipalities = municipalities.map((m, mi) => {
    const municipality = getName(m);
    const sourceSchools = Array.isArray(m.schools) ? m.schools : [];
    const schools = sourceSchools.map((s, si) => {
      const school = getSchoolName(s);
      const municipalitySlug = s.municipalitySlug ?? s.municipality_slug ?? m.slug ?? slugify(municipality);
      const schoolSlug = s.schoolSlug ?? s.school_slug ?? s.slug ?? slugify(school);
      const id = String(s.id ?? s.schoolId ?? s.school_id ?? `${slugify(municipality)}-${slugify(school)}-${mi}-${si}`);
      return {
        ...s,
        id,
        school,
        municipality,
        municipalitySlug,
        schoolSlug,
        parentCount: getCount(s, ['parentCount', 'parents', 'numberOfParents', 'parent_count', 'parentsCount', 'antalForaldrar']),
        studentCount: getCount(s, ['studentCount', 'students', 'numberOfStudents', 'student_count', 'antalElever']),
        whatsappUrl: s.whatsappUrl ?? s.whatsapp ?? s.whatsappLink ?? s.whatsapp_link ?? s.groupLink ?? s.group_link ?? '',
      };
    });
    return { ...m, municipality, slug: m.slug ?? slugify(municipality), schools };
  });
  const schools = normalizedMunicipalities.flatMap(m => m.schools);
  return { municipalities: normalizedMunicipalities, schools };
}

function getPathSelection() {
  const path = decodeURIComponent(window.location.pathname).split('/').filter(Boolean);
  const marker = path.lastIndexOf('hitta-skola');
  if (marker >= 0) {
    return { municipalitySlug: path[marker + 1] ?? '', schoolSlug: path[marker + 2] ?? '' };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get('id') ?? '',
    municipalitySlug: params.get('kommun') ? slugify(params.get('kommun')) : '',
    schoolSlug: params.get('skola') || params.get('school') ? slugify(params.get('skola') ?? params.get('school')) : '',
    municipalityName: params.get('municipality') ?? '',
    schoolName: params.get('school') ?? params.get('skola') ?? '',
  };
}

function App() {
  const [config, setConfig] = useState({ apiUrl: '', siteBaseUrl: '', parentOrigin: '' });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState(null);
  const [routeSelection, setRouteSelection] = useState(getPathSelection);
  const [inFrame, setInFrame] = useState(window.parent !== window);
  const [routeMessage, setRouteMessage] = useState('');

  // Load public runtime configuration and school data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let cfg = {};
        const configUrl = `${import.meta.env.BASE_URL}config.json`;
        const cfgResponse = await fetch(configUrl, { cache: 'no-store' });
        if (cfgResponse.ok) cfg = await cfgResponse.json();
        if (cancelled) return;
        setConfig({
          apiUrl: cfg.apiUrl ?? '',
          siteBaseUrl: String(cfg.siteBaseUrl ?? '').replace(/\/+$/, ''),
          parentOrigin: cfg.parentOrigin ?? '',
        });
        if (!cfg.apiUrl || cfg.apiUrl.startsWith('REPLACE_')) {
          throw new Error('API-adressen saknas. Kopiera public/config.example.json till public/config.json och fyll i apiUrl.');
        }
        const response = await fetch(cfg.apiUrl);
        if (!response.ok) throw new Error(`API svarade med status ${response.status}.`);
        const normalized = normalizePayload(await response.json());
        if (!cancelled) setData(normalized);
      } catch (error) {
        if (!cancelled) setLoadError(`${error.message} Kontrollera också att API:t tillåter CORS.`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Parent page and iframe communicate through a small, origin-checked message protocol.
  useEffect(() => {
    const allowedOrigin = config.parentOrigin;
    const onMessage = (event) => {
      if (allowedOrigin && event.origin !== allowedOrigin) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'KI_DS_PARENT_LOCATION') {
        setInFrame(true);
        setRouteSelection({
          municipalitySlug: msg.municipalitySlug ?? '',
          schoolSlug: msg.schoolSlug ?? '',
          schoolId: msg.schoolId ?? '',
        });
      }
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'KI_DS_APP_READY' }, config.parentOrigin || '*');
    }
    return () => window.removeEventListener('message', onMessage);
  }, [config.parentOrigin]);

  // Resolve URL path or parent-page selection after data has loaded.
  useEffect(() => {
    if (!data) return;
    const id = routeSelection.id ?? routeSelection.schoolId ?? '';
    if (id) {
      const found = data.schools.find(s => s.id === String(id));
      if (found) { setSelection({ type: 'school', value: found }); setQuery(found.school); return; }
    }
    if (routeSelection.schoolSlug) {
      const candidates = data.schools.filter(s =>
        s.schoolSlug === routeSelection.schoolSlug &&
        (!routeSelection.municipalitySlug || s.municipalitySlug === routeSelection.municipalitySlug)
      );
      if (candidates.length === 1) {
        setSelection({ type: 'school', value: candidates[0] });
        setQuery(candidates[0].school);
        setRouteMessage('');
      } else if (candidates.length > 1) {
        setSelection({ type: 'school-search', value: candidates[0].school });
        setQuery(candidates[0].school);
        setRouteMessage('Flera skolor matchar länken. Välj rätt skola i listan.');
      } else if (routeSelection.schoolName) {
        setQuery(routeSelection.schoolName);
        setSelection({ type: 'school-search', value: routeSelection.schoolName });
      }
      return;
    }
    if (routeSelection.municipalitySlug) {
      const municipality = data.municipalities.find(m => m.slug === routeSelection.municipalitySlug);
      if (municipality) {
        setSelection({ type: 'municipality', value: municipality });
        setQuery(municipality.municipality);
      }
      return;
    }
    if (routeSelection.municipalityName) {
      const municipality = data.municipalities.find(m => norm(m.municipality) === norm(routeSelection.municipalityName));
      if (municipality) { setSelection({ type: 'municipality', value: municipality }); setQuery(municipality.municipality); }
    } else if (routeSelection.schoolName) {
      setQuery(routeSelection.schoolName);
      setSelection({ type: 'school-search', value: routeSelection.schoolName });
    }
  }, [data, routeSelection]);

  const matches = useMemo(() => {
    const q = norm(query);
    if (!data || !q) return { schools: [], municipalities: [] };
    return {
      schools: data.schools.filter(s => norm(s.school).includes(q) || norm(s.municipality).includes(q)).slice(0, 60),
      municipalities: data.municipalities.filter(m => norm(m.municipality).includes(q)).slice(0, 30),
    };
  }, [data, query]);

  const schoolUrl = (school) => {
    const base = config.siteBaseUrl;
    if (!base) return '';
    return `${base}/${encodeURIComponent(school.municipalitySlug)}/${encodeURIComponent(school.schoolSlug)}`;
  };
  const municipalityUrl = (municipality) => {
    const base = config.siteBaseUrl;
    if (!base) return '';
    return `${base}/${encodeURIComponent(municipality.slug)}`;
  };

  const navigateToSchool = (school) => {
    const url = schoolUrl(school);
    setSelection({ type: 'school', value: school });
    setQuery(school.school);
    setRouteMessage('');
    if (inFrame && window.parent !== window) {
      window.parent.postMessage({
        type: 'KI_DS_NAVIGATE',
        path: `/foraldrapakten/hitta-skola/${school.municipalitySlug}/${school.schoolSlug}`,
        municipalitySlug: school.municipalitySlug,
        schoolSlug: school.schoolSlug,
        schoolId: school.id,
      }, config.parentOrigin || '*');
    } else if (url) {
      window.history.pushState({ schoolId: school.id }, '', `?id=${encodeURIComponent(school.id)}`);
    } else {
      const current = new URL(window.location.href);
      current.search = `?id=${encodeURIComponent(school.id)}`;
      window.history.pushState({ schoolId: school.id }, '', current);
    }
  };

  const navigateToMunicipality = (municipality) => {
    const url = municipalityUrl(municipality);
    setSelection({ type: 'municipality', value: municipality });
    setQuery(municipality.municipality);
    setRouteMessage('');
    if (inFrame && window.parent !== window) {
      window.parent.postMessage({
        type: 'KI_DS_NAVIGATE',
        path: `/foraldrapakten/hitta-skola/${municipality.slug}/`,
        municipalitySlug: municipality.slug,
      }, config.parentOrigin || '*');
    } else if (url) {
      window.history.pushState({ municipalitySlug: municipality.slug }, '', `?kommun=${encodeURIComponent(municipality.municipality)}`);
    } else {
      const current = new URL(window.location.href);
      current.search = `?kommun=${encodeURIComponent(municipality.municipality)}`;
      window.history.pushState({ municipalitySlug: municipality.slug }, '', current);
    }
  };

  const reset = () => {
    setSelection(null);
    setQuery('');
    setRouteMessage('');
    if (inFrame && window.parent !== window) {
      window.parent.postMessage({ type: 'KI_DS_NAVIGATE', path: '/foraldrapakten/hitta-skola/' }, config.parentOrigin || '*');
    } else {
      const current = new URL(window.location.href);
      current.search = '';
      window.history.pushState({}, '', current);
    }
  };

  useEffect(() => {
    const onPopState = () => setRouteSelection(getPathSelection());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const selectedSchool = selection?.type === 'school' ? selection.value : null;
  const chosenMunicipality = selection?.type === 'municipality' ? selection.value : null;
  const peers = selectedSchool
    ? data.schools.filter(s => s.municipalitySlug === selectedSchool.municipalitySlug && s.id !== selectedSchool.id)
    : [];
  const visibleSchoolList = chosenMunicipality
    ? data.schools.filter(s => s.municipalitySlug === chosenMunicipality.slug)
    : [];

  function SchoolCard({ school, featured = false }) {
    const targetUrl = schoolUrl(school);
    return <article className={`school-card ${featured ? 'featured' : ''}`}>
      <div className="school-card-content">
        <h3>{school.school}</h3>
        <p className="municipality">{school.municipality}</p>
        <dl className="school-stats">
          {school.parentCount !== null && <div className="stat"><dt>Föräldrar</dt><dd>{school.parentCount.toLocaleString('sv-SE')}</dd></div>}
          {school.studentCount !== null && <div className="stat"><dt>Elever</dt><dd>{school.studentCount.toLocaleString('sv-SE')}</dd></div>}
        </dl>
        {school.parentCount === null && school.studentCount === null && <p className="missing-data">Statistik är inte tillgänglig ännu.</p>}
        <div className="school-actions">
          {school.whatsappUrl
            ? <a className="whatsapp-link" href={school.whatsappUrl} target="_blank" rel="noopener noreferrer">Öppna WhatsApp-gruppen ↗</a>
            : <span className="missing-data">Ingen föräldragrupp länkad ännu.</span>}
          {targetUrl && <a className="text-link" href={targetUrl} onClick={(event) => {
            if (inFrame) {
              event.preventDefault();
              navigateToSchool(school);
            }
          }}>Skolans sida ↗</a>}
        </div>
      </div>
    </article>;
  }

  return <main className="app">
    <header className="app-header">
      <p className="eyebrow">Ki-DS Föräldrapakten</p>
      <h1>Hitta min skola</h1>
      <p>Sök efter en skola eller kommun och hitta rätt föräldragrupp.</p>
    </header>

    <section className="search-panel" aria-label="Sök efter skola eller kommun">
      <label className="search-label" htmlFor="school-search">Skola eller kommun</label>
      <div className="search-row">
        <input id="school-search" type="search" value={query}
          onChange={event => { setQuery(event.target.value); setSelection(null); setRouteMessage(''); }}
          onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); setSelection(null); } }}
          placeholder="Skriv skolans eller kommunens namn…" autoComplete="off" />
        {query && <button className="button-secondary clear-button" type="button" onClick={reset}>Rensa</button>}
      </div>
      <p className="search-hint">Sökresultaten visar både skolor och kommuner. Kontrollera kommunen innan du väljer en skola.</p>

      {query.trim() && !selectedSchool && selection?.type !== 'municipality' && <div className="matches">
        {matches.municipalities.length > 0 && <section className="results-section">
          <h2 className="section-heading">Kommuner</h2>
          <div className="results-list">
            {matches.municipalities.map(m => <button className="result-item" key={m.slug} type="button" onClick={() => navigateToMunicipality(m)}>
              <span><span className="result-title">{m.municipality}</span><span className="result-meta">{m.schools.length} skolor</span></span>
              <span className="result-type">Kommun</span>
            </button>)}
          </div>
        </section>}
        {matches.schools.length > 0 && <section className="results-section">
          <h2 className="section-heading">Skolor</h2>
          <div className="results-list">
            {matches.schools.map(s => <button className="result-item" key={s.id} type="button" onClick={() => navigateToSchool(s)}>
              <span><span className="result-title">{s.school}</span><span className="result-meta">Kommun: {s.municipality}</span></span>
              <span className="result-type">Skola</span>
            </button>)}
          </div>
        </section>}
        {!matches.schools.length && !matches.municipalities.length && <p className="empty-state">Inga träffar. Prova ett kortare sökord.</p>}
      </div>}
    </section>

    {loading && <p className="loading-state" role="status">Laddar skolor…</p>}
    {loadError && <p className="error-state" role="alert">{loadError}</p>}
    {routeMessage && <p className="status-message" role="status">{routeMessage}</p>}

    {selectedSchool && <section className="selected-school" aria-live="polite">
      <div className="breadcrumbs"><a href={config.siteBaseUrl || './'} onClick={event => {
        if (inFrame) { event.preventDefault(); reset(); }
      }}>Hitta min skola</a><span>›</span><a href={municipalityUrl(municipalityForSchool(selectedSchool, data)) || '#'} onClick={event => {
        if (inFrame) { event.preventDefault(); navigateToMunicipality(data.municipalities.find(m => m.slug === selectedSchool.municipalitySlug)); }
      }}>{selectedSchool.municipality}</a></div>
      <h2>{selectedSchool.school}</h2>
      <p className="municipality-name">Kommun: {selectedSchool.municipality}</p>
      <SchoolCard school={selectedSchool} featured />
    </section>}

    {chosenMunicipality && <section className="municipality-section" aria-live="polite">
      <div className="breadcrumbs"><a href={config.siteBaseUrl || './'} onClick={event => { if (inFrame) { event.preventDefault(); reset(); } }}>Hitta min skola</a><span>›</span><span>{chosenMunicipality.municipality}</span></div>
      <h2 className="section-heading">Skolor i {chosenMunicipality.municipality}</h2>
      {visibleSchoolList.length
        ? <div className="school-list">{visibleSchoolList.map(s => <SchoolCard key={s.id} school={s} />)}</div>
        : <p className="empty-state">Inga skolor finns registrerade för kommunen.</p>}
    </section>}

    {selectedSchool && peers.length > 0 && <section className="municipality-section">
      <h2 className="section-heading">Övriga skolor i {selectedSchool.municipality}</h2>
      <div className="school-list">{peers.map(s => <SchoolCard key={s.id} school={s} />)}</div>
    </section>}

    {selection?.type === 'school-search' && data && <section className="results-section">
      <h2 className="section-heading">Välj rätt skola</h2>
      <div className="results-list">{data.schools.filter(s => norm(s.school).includes(norm(selection.value))).map(s =>
        <button className="result-item" key={s.id} type="button" onClick={() => navigateToSchool(s)}>
          <span><span className="result-title">{s.school}</span><span className="result-meta">Kommun: {s.municipality}</span></span><span className="result-type">Skola</span>
        </button>)}</div>
    </section>}
  </main>;
}

function municipalityForSchool(school, data) {
  return data?.municipalities.find(m => m.slug === school.municipalitySlug);
}

createRoot(document.getElementById('root')).render(<App />);
