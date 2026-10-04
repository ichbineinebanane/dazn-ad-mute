# DAZN Regional Ad Mute

Firefox-Erweiterung, die den Tab stummschaltet, während DAZN in NFL-Game-Pass-Streams
regionale Werbung einblendet. Die originale US-Werbung bleibt hörbar.

## Wie es funktioniert

DAZN fügt die regionalen Spots per Google DAI (serverseitige Werbeeinblendung) in den
Live-Stream ein. Das DASH-Manifest, das der Player alle 2 s von
`dai.google.com/linear/dash/.../manifest.mpd` lädt, enthält dann zusätzliche Perioden:

```xml
<Period id="dai_pod-0000000011-ad-1" start="PT497377H38M26.143833088S" duration="PT14.981S">
```

Im normalen Spiel und während der US-Werbung gibt es nur Content-Perioden. Die Zeitangaben
der Perioden verwenden dieselbe Zeitskala wie `video.currentTime`.

- `page-hook.js` läuft im Seitenkontext und liest jedes Manifest mit, das der Player über
  `fetch` oder `XMLHttpRequest` lädt. Es merkt sich die `dai_pod-*`-Zeitfenster und prüft
  alle 200 ms, ob die Wiedergabe gerade in einem davon liegt.
- `bridge.js` leitet Beginn und Ende der Werbung an das Hintergrundskript weiter.
- `background.js` schaltet den Tab stumm und wieder laut. Wieder laut schaltet es nur Tabs,
  die die Erweiterung selbst gemutet hat (`tab.mutedInfo`), dein eigenes Muten bleibt also
  erhalten. Ein Klick auf das Erweiterungs-Icon schaltet die Erweiterung ein und aus.

## Installation

Dauerhaft: Paket als „On your own“ (unlisted) auf
[addons.mozilla.org](https://addons.mozilla.org/developers/) signieren lassen und die
signierte `.xpi` installieren.

Zum Testen: `about:debugging#/runtime/this-firefox` öffnen, „Temporäres Add-on laden…“
wählen und `extension/manifest.json` auswählen.

Für ein neues Paket die Version in `manifest.json` erhöhen und die vier Dateien aus
`extension/` direkt in eine ZIP packen, ohne Unterordner.

## Debugging

In der Browser-Konsole (F12) stehen Meldungen mit dem Präfix `[DAZN-AdMute]`:

- `Werbeblock erkannt: dai_pod-...` bedeutet, dass das Manifest gelesen wird.
- `Werbung startet -> mute` und `Werbung vorbei -> unmute` zeigen das Umschalten.
