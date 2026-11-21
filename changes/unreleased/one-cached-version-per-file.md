- **Less memory held after a run (native build).** The server kept the
  volume it had read from a stage's file until newer reads pushed it out,
  also after a run had rewritten the file, although no request can ask for
  a file's earlier version. It now keeps one version of a file: the old one
  goes before the new one is read. The same holds for the ΔPDF and for the
  consistency view's round trip. No value or response changes.
