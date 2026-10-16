# Design

C Forge keeps reading and coding in the same workspace. A quiet navigation rail
holds the learning path; the lesson view gives instructions and the editor their
own resizable panes. Phones use Learn, Code and Results tabs.

## Palette and type

Warm white `#f5f4ef` and graphite `#1c1d22` form the light and dark surfaces.
Cobalt `#4056c7` marks actions; periwinkle `#b9c7ff` identifies the resume area.
Apricot, sage and lavender distinguish course chapters and learning feedback.
Borders separate functional regions without adding decorative gradients.

Newsreader is used for headings, Open Sans for prose and controls, and DejaVu
Sans Mono for source code. All font files and their licenses are bundled locally.
Text sizes and line spacing follow the learner's preferences.

## Course choice

The header selector names the language and baseline, C17 or C++20. It remains
available at phone widths, has a visible keyboard focus state, and waits for the
account preference update before re-enabling. The selected course controls the
path, projects, reference entries and editor labels.

## Content and feedback

Use real lesson objectives and short, concrete instructions. Run and Check have
different labels because they have different effects. Save indicators describe
acknowledged device or account writes. Infrastructure failures preserve drafts
and never appear as successful program runs.

The forge mark and palette stay consistent across account entry, navigation and
lesson views. Reduced-motion preferences are respected. Screenshots in the README
come from the rendered application rather than a separate mockup.
