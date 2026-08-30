//! Modrinth 搜索/浏览 API（M13 模组/模组包）。
//!
//! lighty-modsloader 只能按「已知 project/version id」拉元数据用于安装，**没有**暴露
//! `/v2/search` 的浏览式搜索。故此处直接调 Modrinth 公共搜索 API 做浏览页：
//!   - GET /v2/search?facets=[["project_type:modpack"]]&query=...   （搜索模组包/模组）
//!   - GET /v2/project/{slug}                                        （详情，含图标/简介/downloads）
//!   - GET /v2/project/{slug}/version                                （版本列表，选版本建实例）
//!
//! 一律走 lighty 共享 async `HTTP_CLIENT`（绝不在异步上下文 new blocking client，见 M12 坑）。
//! 默认头带 User-Agent（Modrinth 强制要求）。

use serde::{Deserialize, Serialize};

/// Modrinth 搜索结果条目（对齐前端卡片 + 详情需要）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthSearchHit {
    pub slug: String,
    pub title: String,
    pub description: String,
    #[serde(rename = "icon_url")]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub downloads: u64,
    /// Modrinth search 返回 `follows`（关注数）；detail `/v2/project/{id}` 返回 `followers`。两个都封到 `followers`。
    #[serde(default, alias = "follows")]
    pub followers: u64,
    #[serde(rename = "project_type", default)]
    pub project_type: String,
    #[serde(default)]
    pub categories: Vec<String>,
    /// 已发布的 MC 版本列表（`game_versions`→`versions`，去重）
    #[serde(rename = "versions", default)]
    pub game_versions: Vec<String>,
    #[serde(rename = "client_side")]
    pub client_side: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModrinthSearchResponse {
    pub hits: Vec<ModrinthSearchHit>,
    pub total_hits: u64,
    pub offset: u64,
    pub limit: u64,
}

/// Modrinth 版本条目（详情页选版本建实例用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthVersion {
    pub id: String,
    #[serde(rename = "version_number")]
    pub version_number: String,
    #[serde(rename = "game_versions", default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(rename = "date_published")]
    pub date_published: String,
    #[serde(rename = "version_type")]
    pub version_type: String,
    #[serde(default)]
    pub files: Vec<ModrinthVersionFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthVersionFile {
    pub url: String,
    pub filename: String,
    pub size: u64,
    #[serde(default)]
    pub primary: bool,
}

/// 项目类型 facet：modpack / mod；空 = 不限制。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchFacet {
    Modpack,
    Mod,
    All,
}

impl SearchFacet {
    fn facet_str(&self) -> &'static str {
        match self {
            SearchFacet::Modpack => "project_type:modpack",
            SearchFacet::Mod => "project_type:mod",
            SearchFacet::All => "",
        }
    }
}

const BASE_URL: &str = "https://api.modrinth.com/v2";
const USER_AGENT: &str = "MikoLauncher/0.1.0 (MikoLauncher desktop; +https://github.com/miko-p/mikoLauncher)";

fn client() -> &'static reqwest::Client {
    &lighty_core::hosts::HTTP_CLIENT
}

/// 搜索 Modrinth 项目（模组包/模组）。`query` 为空则取该排序下的热门/最新全量。
/// `index`：relevance | downloads | follows | newest | updated（仿 HMCL 的排序选项）。
pub async fn search(
    query: &str,
    facet: SearchFacet,
    index: &str,
    limit: u64,
    offset: u64,
) -> Result<ModrinthSearchResponse, String> {
    let index = match index {
        "downloads" => "downloads",
        "follows" => "follows",
        "newest" => "newest",
        "updated" => "updated",
        _ => "relevance",
    };
    let mut url = format!(
        "{BASE_URL}/search?limit={limit}&offset={offset}&index={index}"
    );
    if !query.trim().is_empty() {
        url.push_str(&format!(
            "&query={}",
            lighty_modsloader::modrinth::api::url_encode(query.trim())
        ));
    }
    if facet != SearchFacet::All {
        // facets 需 JSON 编码的二维数组，过滤 project_type（如 [["project_type:modpack"]]）
        let f = facet.facet_str();
        let facet_json = format!("[[\"{f}\"]]");
        url.push_str(&format!("&facets={}", urlencode(&facet_json)));
    }

    let resp = client()
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("请求 Modrinth 搜索失败: {e}"))?;
    let body = resp
        .error_for_status()
        .map_err(|e| format!("Modrinth 搜索 HTTP 错误: {e}"))?;
    let raw: serde_json::Value = body
        .json()
        .await
        .map_err(|e| format!("解析 Modrinth 搜索失败: {e}"))?;

    // `hits` 是数组（字段与 ModrinthSearchHit 略有出入，宽松收窄）；total_hits 是总数
    let total_hits = raw.get("total_hits").and_then(|v| v.as_u64()).unwrap_or(0);
    let hits: Vec<ModrinthSearchHit> = raw
        .get("hits")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|h| serde_json::from_value::<ModrinthSearchHit>(h.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(ModrinthSearchResponse {
        hits,
        total_hits,
        offset,
        limit,
    })
}

/// 拉单个 Modrinth 项目详情（按 slug 或 id）。
pub async fn project(slug: &str) -> Result<ModrinthSearchHit, String> {
    let url = format!("{BASE_URL}/project/{slug}");
    let resp = client()
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("请求 Modrinth 项目失败: {e}"))?;
    let body = resp
        .error_for_status()
        .map_err(|e| format!("Modrinth 项目 HTTP 错误（{slug}）: {e}"))?;
    body.json()
        .await
        .map_err(|e| format!("解析 Modrinth 项目失败: {e}"))
}

/// 拉 Modrinth 项目所有版本（date-desc，取前 N 个供详情页选择）。
pub async fn project_versions(slug: &str, limit: usize) -> Result<Vec<ModrinthVersion>, String> {
    let url = format!("{BASE_URL}/project/{slug}/version");
    let resp = client()
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("请求版本列表失败: {e}"))?;
    let body = resp
        .error_for_status()
        .map_err(|e| format!("版本列表 HTTP 错误（{slug}）: {e}"))?;
    let versions: Vec<ModrinthVersion> = body
        .json()
        .await
        .map_err(|e| format!("解析版本列表失败: {e}"))?;
    Ok(versions.into_iter().take(limit).collect())
}

/// `.mrpack` 里一个模组文件的清单元数据（M13：创建实例后立即填进实例 mods 列表展示）。
#[derive(Debug, Clone, Serialize)]
pub struct ModpackFileMeta {
    /// 包内路径（如 `mods/sodium.jar` 或 `overrides/...`）
    pub path: String,
    /// 文件名（不含目录，供展示/落盘）
    pub file_name: String,
    /// 下载 URL（`.mrpack` 里列的第一下载源）
    pub url: String,
    pub sha1: String,
    pub size: u64,
    /// 是否客户端必需（env.client=="required"；旧包无 env 视为必需）
    pub client_required: bool,
}

/// 下载 .mrpack（zip）并解析 `modrinth.index.json` 的 files 清单。
/// 目的：创建实例后立刻拿到该 modpack 包含的模组列表，填进实例 mods 展示（文件本体仍由首次启动时 lighty 实装）。
pub async fn resolve_modpack_files(file_url: &str) -> Result<Vec<ModpackFileMeta>, String> {
    let resp = client()
        .get(file_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("下载 .mrpack 失败: {e}"))?;
    let body = resp
        .error_for_status()
        .map_err(|e| format!("下载 .mrpack HTTP 错误: {e}"))?;
    let bytes = body
        .bytes()
        .await
        .map_err(|e| format!("读取 .mrpack 失败: {e}"))?;

    // 从 zip 里读 `modrinth.index.json`
    let reader = std::io::Cursor::new(&bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("解析 .mrpack（zip）失败: {e}"))?;
    let manifest_json = {
        let names = zip.file_names().map(|s| s.to_string()).collect::<Vec<_>>();
        let hit = names.iter().find(|n| n.ends_with("modrinth.index.json"));
        let idx = hit.ok_or_else(|| "`.mrpack` 内找不到 modrinth.index.json".to_string())?;
        let mut f = zip
            .by_index(names.iter().position(|n| n == idx).ok_or("索引错误")?)
            .map_err(|e| format!("读取 modrinth.index.json 失败: {e}"))?;
        let mut s = String::new();
        use std::io::Read;
        f.read_to_string(&mut s).map_err(|e| format!("读取 modrinth.index.json 失败: {e}"))?;
        s
    };

    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_json).map_err(|e| format!("解析 modrinth.index.json 失败: {e}"))?;
    let files = manifest
        .get("files")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "modrinth.index.json 缺少 files 列表".to_string())?;

    let mut out = Vec::new();
    for f in files {
        let path = f.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let sha1 = f.get("hashes").and_then(|h| h.get("sha1")).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let size = f.get("fileSize").and_then(|v| v.as_u64()).unwrap_or(0);
        let url = f
            .get("downloads")
            .and_then(|d| d.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // client 必需：env.client=="required"；旧包无 env 视为必需
        let client_required = matches!(
            f.get("env")
                .and_then(|e| e.get("client"))
                .and_then(|v| v.as_str()),
            Some("required") | None
        );
        let file_name = std::path::Path::new(&path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        out.push(ModpackFileMeta {
            path,
            file_name,
            url,
            sha1,
            size,
            client_required,
        });
    }
    Ok(out)
}

/// 最小 URL 编码（用于 facets JSON 等）。
fn urlencode(input: &str) -> String {
    lighty_modsloader::modrinth::api::url_encode(input)
}

/// 下载远程图片并编码为 data URI（`data:image/<ext>;base64,...`）。
/// 目的：把 Modrinth 模组包图标存进实例 `icon`（`InstanceSchema.icon` 是 data-URI base64），
/// 使从模组包创建的实例图标跟随模组包图标。前端 CSP `connect-src` 未放行 cdn，故下载放到 Rust。
fn mime_from_url(url: &str) -> &'static str {
    let p = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if p.ends_with(".png") {
        "png"
    } else if p.ends_with(".webp") {
        "webp"
    } else if p.ends_with(".gif") {
        "gif"
    } else if p.ends_with(".svg") {
        "svg+xml"
    } else {
        "jpeg"
    }
}

pub async fn download_icon(url: &str) -> Result<String, String> {
    let resp = client()
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("下载图标失败: {e}"))?;
    let body = resp
        .error_for_status()
        .map_err(|e| format!("下载图标 HTTP 错误: {e}"))?;
    let bytes = body.bytes().await.map_err(|e| format!("读取图标失败: {e}"))?;
    // 图标一般很小；上限防超大图/异常下载塞满 DB
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(format!("图标文件过大（>2MB）：{} 字节", bytes.len()));
    }
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/{};base64,{}", mime_from_url(url), b64))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 Modrinth search hit 能按我们的 struct 反序列化（此前 `followers` 缺失导致整条被滤空 → 前端"没有结果"）。
    #[test]
    fn search_hit_deserializes() {
        let json = r#"{
            "slug":"fabulously-optimized","title":"Fabulously Optimized","description":"desc",
            "icon_url":"https://cdn.modrinth.com/x.png","downloads":16551547,"follows":123,"project_type":"modpack",
            "categories":["optimization"],"versions":["1.21.4","1.20.6"],"client_side":"required"
        }"#;
        let hit: ModrinthSearchHit = serde_json::from_str(json).expect("hit should deserialize");
        assert_eq!(hit.slug, "fabulously-optimized");
        assert_eq!(hit.downloads, 16_551_547);
        assert_eq!(hit.followers, 123);
        assert_eq!(hit.project_type, "modpack");
        assert_eq!(hit.game_versions.len(), 2);
    }
}
