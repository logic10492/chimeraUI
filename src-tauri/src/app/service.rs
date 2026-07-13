use std::{
    process::Child,
    sync::{
        atomic::{AtomicBool, AtomicU32},
        Mutex,
    },
};

pub struct OwnedServiceProcess {
    pub child: Child,
    #[cfg(unix)]
    pub process_group_id: i32,
}

/// 跟踪由桌面应用启动并负责清理的 chimera serve 进程
pub struct ServiceState {
    /// 我们启动的子进程 PID
    pub child_pid: AtomicU32,
    /// 是否仍由应用拥有（用于关闭时判断是否需要询问和清理）
    pub we_started: AtomicBool,
    /// 我们启动的 chimera serve 实际地址
    pub service_url: Mutex<Option<String>>,
    /// 保留直接子进程句柄，以便终止后可靠回收
    pub owned_process: Mutex<Option<OwnedServiceProcess>>,
    /// 串行化启动请求；停止和退出清理仍可在 readiness probing 期间抢占 ownership
    pub start_lock: tokio::sync::Mutex<()>,
}

impl Default for ServiceState {
    fn default() -> Self {
        Self {
            child_pid: AtomicU32::new(0),
            we_started: AtomicBool::new(false),
            service_url: Mutex::new(None),
            owned_process: Mutex::new(None),
            start_lock: tokio::sync::Mutex::new(()),
        }
    }
}
