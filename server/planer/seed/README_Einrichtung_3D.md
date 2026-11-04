# Ferienhaus Fernblick – Einrichtungsmodell v0.2 (Stand 04.11.2026)

Dieses Paket ist die Übergabe an Claude Code für einen begehbaren 3D-Viewer mit verschiebbaren Möbeln.

| Datei | Inhalt |
|---|---|
| `haus_fernblick.json` | Hausmodell: Geschosse, Räume, Wände, Öffnungen, feste Elemente, Möbel, Leuchten, offene Fragen |
| `Grundriss_EG_OG_v0.2.png` | Aus dem JSON gerenderter Kontrollplan (1 m = 62 px) |
| `render.py` / `build.py` | Skripte, die das JSON erzeugen bzw. den Plan daraus zeichnen |

## Koordinatensystem
- Einheit Meter. Ursprung = Innenecke Nordwest EG (Innenkante Außenwand).
- x nach Osten, y nach Süden (Glasfront/Terrasse liegt im Süden), z nach oben ab Fertigfußboden EG.
- OG-Fertigfußboden auf z = 2,81. Quelle: Treppen-Werkplan V1 vom 12.05.2026, Geschosshöhe 2810 mm, 16 Steigungen à 175,62 mm.
- EG-Decke ist eine Sichtbalkendecke. Aufbau laut Murat: Balken 0,21 + Schalung 0,02 + 0,045 + Estrich 0,065. Daraus folgen: Balken-Unterkante z = 2,47, Schalung-Unterkante z = 2,68.
- Offen sind Balkenbreite (angenommen 0,10), Achsabstand (angenommen 0,625) und Spannrichtung. Maßgebend ist die Geschosshöhe 2,81 m laut Treppenbauer; die von Murat genannten 2,85 m sind vermutlich ab Rohboden gemessen (bestätigt 04.11.).
- Traufhöhe 4,00 m ab FFB EG (Küchenansicht). Daraus ergibt sich ein Kniestock OG von 1,19 m an beiden Längsseiten; der Bauantrag nennt ca. 1,10 m.
- Dach: Satteldach 38°, First in Nord-Süd-Richtung bei x = 3,89. Sparren im OG sichtbar, Richtung Ost-West.
- Pfette Nord-Süd bei x = 3,89, Unterkante ca. 5,0 m (Murat). Das Esstisch-Pendel hängt darunter.
- Außenwände: `von`/`bis` ist die Innenkante, die Dicke (0,36) geht nach außen. Innenwände: `von`/`bis` ist die Wandachse.
- Möbel: `pos` = Mittelpunkt im Grundriss, `masse_bth` = [Breite entlang x bei rot 0, Tiefe entlang y bei rot 0, Höhe]. `rot_grad` dreht um die Hochachse. `z` (falls gesetzt) = Unterkante über Geschossboden (Wandregale, hängende Möbel).
- Felder `quelle` und `sicher` kennzeichnen, was gemessen, was aus Plan abgegriffen und was Konzept ist.

## Anforderungen an den 3D-Viewer (Vorschlag für Claude Code)
1. Eine HTML-Seite mit three.js, die `haus_fernblick.json` lädt.
2. Wände extrudieren, Öffnungen ausschneiden, Glas transparent. Luftraum über Wohnen offen bis Dach. Dachschrägen im OG nach Kniestock/Neigung.
3. Holzbalkendecke im EG, Sparren sichtbar im OG. Boden Vinyl Eiche hell.
4. Begehen mit WASD + Maus in Augenhöhe 1,65 m, Treppe als Rampe begehbar. Dazu eine Draufsicht zum Umschalten.
5. Möbel als einfache Quader/Zylinder in der angegebenen Farbe. Klicken wählt aus, Ziehen verschiebt auf dem Boden, R dreht um 90°. Mit Kollisionswarnung gegen Wände, Treppe und Laufwege.
6. Möbelbibliothek zum Austauschen, z. B. Ecksofa ↔ 3er+2er, Tisch 180×90 ↔ 200×100.
7. Änderungen als JSON exportieren, damit Claude sie wieder einlesen kann.
8. Feste Elemente (Treppe, Küche, Bad-Objekte, Lamellenwand, Brüstung) gesperrt.

## Wandoberflächen (Feld `oberflaechen` im JSON)
- Standard für alle Wände: Rollputz weiß.
- Sichtholz:
  - Die Wand vom Wohnraum Richtung Schlafzimmer und Kinderzimmer. Im EG ist das die Südseite der Schlafzimmerwand, im OG die Südseite der Kinderzimmerwand. Sie ist durchgehend bis an die Pfette verkleidet.
  - Die Wand zwischen Galerie und Kinderzimmer, Galerieseite. Die Kinderzimmerseite ist Rollputz weiß.
  - Material: Fichte-Dreischichtplatten natur, wie die Balken.
- Bad, Aluverbundplatten hellgrau/greige laut Foto:
  - ganze Nordwand
  - Duschwand Ost
  - WC-Vorwand
  - Spritzschutz hinter dem Waschtisch bis ca. 1,25 m
  - Die Ausdehnung ist aus dem Foto geschätzt; Murat hat das so akzeptiert.

## Treppe (Werkplan VIWELD/Warkentin V1, 12.05.2026)
- Halbgewendelt mit 16 Steigungen à 175,62 mm, Auftritt 260 mm, Laufbreite 900/920 mm.
- Belag Eiche Parkett 40 mm, Wangen Stahl RAL 9005 matt.
- Antritt Stufe 1 am Ostende des unteren Laufs (x = 1,56). Der Lauf geht nach Westen, die Wende (Stufen 5–8) liegt an der Westwand, die Stufen 9–16 laufen entlang der Schlafzimmerwand nach Osten bis zum Deckenloch (2,98 m).
- Zur Wohnseite zeigt eine geschlossene Freiwange. Die Absturzsicherung stellt der Bauherr.

## Raumkonzepte

### Wohnen / Kochen / Essen (EG) – Variante D
- Ecksofa (Kandidat CARRYHOME 284×162, Recamiere an der Treppenwange), runder Couchtisch Ø 70 und Wollteppich nur unter der Lounge.
- Esstisch 180×90 in Nord-Süd-Richtung, mittig unter Pfette und Pendel (x = 3,90). Esssofa oliv auf der Lounge-Seite, 2 Stühle auf der Küchenseite, 1 Kopfstuhl im Norden. Kein Stuhl im Süden, damit die Hebeschiebetür frei bleibt; ihre Öffnung liegt am Mittelpfosten.
- Pendel: runder Baldachin mit 3 Leuchten im Kreis, gestaffelt, Unterkante ca. 70 cm über dem Tisch.
- Küche Kempf 4,51 m an der Ostwand mit kurzem Eck an der Küche/Flur-Wand. 3 Wandregale à 60 cm aus Eiche (links vom Fenster eines, rechts zwei übereinander). Split-Klimagerät über dem Fenster.
- Lamellenwand Eiche zwischen Diele und Küche: 1,5 m lang, raumhoch.
- Das ältere ChatGPT-Bild mit TV und zwei Sofas ist überholt. Es zeigt außerdem eine falsche Wendeltreppe.

### Küche (Render „Blick vom Esszimmer“)
Abweichungen des Renders von der echten Küche:
- Fronten: Render taupe, real cremegrau.
- Regale: Render zeigt 4, geplant sind 3.
- Spüle: Render unter dem Fenster, real nördlich davon.
- Pendel: Render zeigt eine Kuppel, geplant ist der Kreis-Baldachin.

Was übernommen wird: Unterbau-LED, Up/Down-Wandleuchten links und rechts vom Fenster (stehen auch im Lichtplan), Split-Gerät über dem Fenster.

### Schlafzimmer (EG)
- Bett 180×200 mit dem Kopfteil an der Nordwand (Bettwand 2,94 m), Fenster links an der Westwand.
- Hängende Nachttische Eiche, Wandboard über dem Bett, Up/Down-Leselampen und Teppich quer unter dem Bett.
- Ergänzt gegenüber dem Render: Kleiderschrank 150 cm an der Südwand.
- Hinweis: Die Bett-Steckdose K14 liegt hinter dem Kopfteil.

### Diele (EG)
- Haustür in der Ostwand mit Milchglas-Seitenteil. Sie schlägt nach Norden zur Badwand auf.
- Auf der massiven Wand Küche/Flur (1,2 m, südlich der Tür): Lamellen-Garderobe mit Haken, darunter eine Schuhbank. Lüftungsauslass FL-5 freihalten.
- Spiegel südlich der Haustür. Dort ist nur ca. 0,55 m Platz bis zum Schalter FL-1.
- Das Wandboard aus dem Render (links neben der Tür) liegt im Schwenkbereich der Haustür. Ich habe es an die HWR-Wand westlich der HWR-Tür versetzt.
- Läufer ca. 80×200.

### Bad (EG) – Ist-Zustand aus Foto + Render
- Walk-in-Dusche in der Nordost-Ecke mit Glaswand und schwarzen Armaturen.
- WC wandhängend an der Ostwand vor einer Vorwand (h ≈ 1,20), darüber das Fenster.
- Waschtisch an der Westwand: Fronten weiß geriffelt, Platte Eiche, gesprenkeltes Aufsatzbecken. Daneben ein schwarzer Handtuchheizkörper.
- Aus dem Render ergänzt: runder hinterleuchteter Spiegel, Pendelleuchte über dem Waschtisch, Badläufer.
- Die Positionen sind aus dem Foto geschätzt, ±15 cm.

### Kinderzimmer (OG)
- 2 Einzel-/Tagesbetten 80×200 (BRIMNES, ausziehbar) längs am westlichen Kniestock, dazwischen ein Nachttisch.
- Schreibtisch 140×60 vor dem bodentiefen Giebelfenster, Teppich in der Mitte.
- Der Render zeigt Schrägen auf beiden Seiten. Real gibt es nur die Westschräge; die Ostseite ist eine gerade Wand zur Galerie mit Schiebetür.
- Die Schiebetür öffnet, von der Galerie gesehen, von rechts nach links, also von Nord nach Süd. Der Flügel parkt südlich der Öffnung, angenommen auf der Galerieseite. Dieser Bereich bleibt frei.

### Galerie (OG) – neues Konzept „Chill-Lounge“ (Claude)
- Die bereits ausgesuchten GULLVALLA-Sofas wandern hierher: 3er mit dem Rücken an den östlichen Kniestock (Rücken 78 cm, Kniestock 110 cm), 2er an der Nordgiebelwand. Zusammen eine L-Ecke im Nordosten.
- Couchtisch Eiche, großer weicher Teppich, Sitzsäcke/Bodenkissen für Kinder.
- Lesesessel mit Stehleuchte am Giebelfenster (Nordwest-Ecke der Galerie).
- Niedriges Regal für Bücher und Spiele am Kniestock südlich der Sofas.
- Optional ein hängendes TV-Board (180) an der Kinderzimmerwand nördlich der Schiebetür. Sehabstand ca. 2,6 m.
- 1 m vor der Glasbrüstung bleibt möbelfrei, damit nichts als Kletterhilfe dient. Der Laufweg von der Treppe zur Kinderzimmertür bleibt frei.

## Offene Punkte
Siehe `offene_fragen` im JSON. Die wichtigsten:
- Sichtbalken: Breite, Abstand, Richtung
- Galerie-Konzept abstimmen

Das HWR bekommt kein Einrichtungskonzept.
