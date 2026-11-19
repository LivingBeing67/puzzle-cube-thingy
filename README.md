# Puzzle Cube Thingy

A browser tool for designing interlocking cube puzzles: split an N×N×N cube into pieces made of unit cubes, then view them in 3D and pull them apart.

Open `index.html` in a browser. There's no build step; three.js loads from a CDN.

## Features

- **Layer painter:** paint each horizontal layer on a 2D grid. This is how you reach cells buried inside the cube. Click or drag to paint, and right-click (or click the active piece) to erase. Dots show what's in the layer below.
- **3D editor:** click empty space to place on the current layer, or click a cube's face to add a neighbour. Shift-click or right-click removes a cube, and Alt-click picks that cube's piece.
- **Explode / solo / slice:** pull pieces apart, show only the active piece, or hide the layers above the current one.
- **Validation:** shows empty cells, empty pieces, and pieces split into disconnected parts.
- **Undo/redo, autosave** (localStorage) and **JSON export/import**.

## Announcements

Show a 10-second banner to everyone using the live site:

```sh
./announce.sh "New 5x5x5 example is up!"     # new visitors see it for the next 30 min
./announce.sh "Maintenance at 6pm" 120        # ...or for the next 120 min
./announce.sh --on-open "Hi!"                 # only when someone opens the site, not live
./announce.sh --sound wilhelm "AAAAH!"        # play a sound from sounds/ too
./announce.sh --image scare "boo"             # pop an image from images/ up full screen for 1.5s
./announce.sh --then-image scare "Everyone reload the page!"   # surprise after they reload
./announce.sh --visitor larry --say "hi"      # images/larry.* slides in, spins, says it, leaves
./announce.sh --clear                         # take it down
```

The script writes `announcement.json`, commits and pushes it, and Vercel and GitHub Pages redeploy. People with the site open see the banner within about 10 seconds of the deploy finishing. Each person sees each announcement once.

Browsers only allow sound after the visitor has clicked or typed on the page. If the sound is blocked, the banner shows a 🔊 button, and the sound plays on their next click or key press.

## Shortcuts

| Key | Action |
| --- | --- |
| `[` / `]` | Layer down / up |
| `1`–`9` | Select piece |
| `N` | New piece |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo / redo |

## Credits

`sounds/wilhelm.mp3`: the Wilhelm scream (1951), public domain, from the [Internet Archive](https://archive.org/details/WilhelmScreamSample).

`sounds/obnoxious.wav`: original, generated for this project.
