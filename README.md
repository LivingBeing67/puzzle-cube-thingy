# Puzzle Cube Thingy

A browser tool for designing interlocking cube puzzles: split an N×N×N cube into pieces made of unit cubes, then view them in 3D and pull them apart.

Open `index.html` in a browser. There's no build step; three.js loads from a CDN.

## Features

- **Layer painter:** paint each horizontal layer on a 2D grid. This is how you reach cells buried inside the cube. Click or drag to paint, and right-click (or click the active piece) to erase. Dots show what's in the layer below.
- **3D editor:** click empty space to place on the current layer, or click a cube's face to add a neighbour. Shift-click or right-click removes a cube, and Alt-click picks that cube's piece.
- **Explode / solo / slice:** pull pieces apart, show only the active piece, or hide the layers above the current one.
- **Validation:** shows empty cells, empty pieces, and pieces split into disconnected parts.
- **Undo/redo, autosave** (localStorage) and **JSON export/import**.

## Shortcuts

| Key | Action |
| --- | --- |
| `[` / `]` | Layer down / up |
| `1`–`9` | Select piece |
| `N` | New piece |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo / redo |
