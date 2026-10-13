# Ki-DS Föräldrapakten – Hitta min skola

React + Vite-app för GitHub Pages och inbäddning via iframe. Appen har en gemensam sökning för skolor och kommuner, visar skolans kommun, statistik när data finns, WhatsApp-länk och övriga skolor i samma kommun. Grunddesignen ligger i `src/style.scss`.

## Kom igång

1. Installera Node.js LTS.
2. Kör `npm install`.
3. Kopiera `public/config.example.json` till `public/config.json`.
4. Fyll i `apiUrl`, `siteBaseUrl` och `parentOrigin` i `public/config.json`.
5. Kör `npm run dev` för lokal utveckling.
6. Kör `npm run build` för att skapa `dist/`.

`config.json` är offentlig i en statisk app. Lägg aldrig hemligheter eller privata API-nycklar där. API:t måste tillåta CORS från appens publicerade origin.

## Konfiguration

Exempel:

```json
{
  "apiUrl": "https://DIN-PUBLIKA-API-ADRESS",
  "siteBaseUrl": "https://din-sajt.se/foraldrapakten/hitta-skola",
  "parentOrigin": "https://din-sajt.se"
}
```

Ta bort mellanslaget i exempelvärdet `DIN-SA JTADRESS` och ersätt med den verkliga domänen.

- `apiUrl`: URL till JSON-API:t.
- `siteBaseUrl`: basen för delningslänkar till kommuner/skolor.
- `parentOrigin`: exakt origin för sajten som bäddar in appen. Utan trailing slash.

## URL-struktur på sajten

- Start: `/foraldrapakten/hitta-skola/`
- Kommun: `/foraldrapakten/hitta-skola/mellerud/`
- Skola: `/foraldrapakten/hitta-skola/mellerud/karolinerskolan`

Sajten behöver vara konfigurerad att servera sin sida för dessa sökvägar, även vid direktladdning/omladdning. Kommun- och skolsluggar kan komma från `slug`, `municipalitySlug`, `schoolSlug` eller genereras från namnen. Om API:t innehåller stabila ID:n används de för att skilja skolor med samma namn.

## Iframe-kommunikation

Appen kommunicerar med föräldrasidan med `postMessage`. Föräldrasidan behöver:
1. Lyssna efter `KI_DS_APP_READY` från iframe.
2. Skicka `KI_DS_PARENT_LOCATION` med `municipalitySlug`, `schoolSlug` och gärna `schoolId` när aktuell adress laddas eller ändras.
3. Lyssna efter `KI_DS_NAVIGATE` och uppdatera sajten till meddelandets `path` via History API/router.
4. Lyssna på `popstate` på sajten och skicka aktuell plats till iframe igen.

Exempel på integrationskod för föräldrasidan:

```html
<iframe id="school-finder" src="https://DIN-GITHUB-PAGES-APP/" title="Hitta min skola"></iframe>
<script>
(() => {
  const frame = document.getElementById('school-finder');
  const appOrigin = 'https://DIN-GITHUB-PAGES-APP-DOMÄN';
  const parentOrigin = window.location.origin;

  function currentLocation() {
    const parts = decodeURIComponent(location.pathname).split('/').filter(Boolean);
    const index = parts.lastIndexOf('hitta-skola');
    return {
      type: 'KI_DS_PARENT_LOCATION',
      municipalitySlug: index >= 0 ? (parts[index + 1] || '') : '',
      schoolSlug: index >= 0 ? (parts[index + 2] || '') : ''
    };
  }
  function sendLocation() {
    frame.contentWindow?.postMessage(currentLocation(), appOrigin);
  }

  window.addEventListener('message', event => {
    if (event.origin !== appOrigin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'KI_DS_APP_READY') sendLocation();
    if (event.data?.type === 'KI_DS_NAVIGATE') {
      const target = event.data.path;
      if (typeof target !== 'string' || !target.startsWith('/foraldrapakten/hitta-skola/')) return;
      history.pushState({}, '', target);
      sendLocation();
    }
  });
  window.addEventListener('popstate', sendLocation);
  frame.addEventListener('load', sendLocation);
})();
</script>
```

Byt ut `src` och `appOrigin` mot appens riktiga publicerade adress. Använd exakt origin; tillåt inte godtyckliga `postMessage`-avsändare.

## API-format

API:t ska returnera antingen en array med kommuner eller ett objekt med `data`, `municipalities`, `results` eller `result`. Varje kommun ska innehålla `municipality` eller `name` och en `schools`-array. Skolor kan innehålla `id`, `school`/`name`, `parentCount`, `studentCount`, `whatsappUrl`. Fälten för statistik kan saknas; då visas de inte som noll.

## Begränsningar

- Appen använder data från API:t; ingen inbyggd offlinekopia finns.
- Appen kan skapa och skicka rätt sajtadress, men sajten måste ha route-stöd för de adresserna.
- Om skolans API-data saknar unika ID:n och två skolor har samma namn i samma kommun bör ett stabilt ID läggas till i API:t.
