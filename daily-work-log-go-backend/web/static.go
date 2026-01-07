package web

import "embed"

// BuildFS 內嵌 React build 出來的靜態檔案
//go:embed all:build
var BuildFS embed.FS
