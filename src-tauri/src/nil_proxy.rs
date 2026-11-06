//! NIL-owned proxy orchestration domain. No Hiddify application dependency.
//! Transport backends are separate, replaceable adapters.
//! Never mark a node healthy without a successful measured connection.
use std::collections::{HashMap, HashSet};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting { node_id: String },
    Connected { node_id: String },
    Failed { message: String },
}

#[derive(Debug, Clone)]
pub struct Node {
    pub id: String,
    pub uri: String,
    pub protocol: String,
    pub measured_latency: Option<Duration>,
    pub reachable: Option<bool>,
}

pub fn select_best(nodes: &[Node]) -> Option<&Node> {
    nodes.iter()
        .filter(|n| n.reachable == Some(true) && n.measured_latency.is_some())
        .min_by_key(|n| n.measured_latency)
}

pub fn deduplicate(nodes: Vec<Node>) -> Vec<Node> {
    let mut seen = HashSet::new();
    nodes.into_iter().filter(|node| seen.insert(node.id.clone())).collect()
}

pub fn limit_per_protocol(nodes: Vec<Node>, max: usize) -> Vec<Node> {
    let mut counts = HashMap::new();
    nodes.into_iter().filter(|node| {
        let count = counts.entry(node.protocol.clone()).or_insert(0usize);
        if *count >= max { return false; }
        *count += 1;
        true
    }).collect()
}

pub trait TunnelBackend {
    fn connect(&mut self, node: &Node) -> Result<(), String>;
    fn disconnect(&mut self) -> Result<(), String>;
    fn is_connected(&self) -> bool;
}

pub struct NilController<B: TunnelBackend> {
    pub state: ConnectionState,
    backend: B,
}
impl<B: TunnelBackend> NilController<B> {
    pub fn new(backend: B) -> Self { Self { state: ConnectionState::Disconnected, backend } }
    pub fn connect(&mut self, node: &Node) -> Result<(), String> {
        self.state = ConnectionState::Connecting { node_id: node.id.clone() };
        match self.backend.connect(node) {
            Ok(()) if self.backend.is_connected() => {
                self.state = ConnectionState::Connected { node_id: node.id.clone() };
                Ok(())
            }
            Ok(()) => {
                let msg = "Tunnel backend did not confirm a connection".to_string();
                self.state = ConnectionState::Failed { message: msg.clone() };
                Err(msg)
            }
            Err(error) => {
                self.state = ConnectionState::Failed { message: error.clone() };
                Err(error)
            }
        }
    }
    pub fn disconnect(&mut self) -> Result<(), String> {
        self.backend.disconnect()?;
        if self.backend.is_connected() { return Err("Backend still connected".into()); }
        self.state = ConnectionState::Disconnected;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Mock { connected: bool }
    impl TunnelBackend for Mock {
        fn connect(&mut self, _node: &Node) -> Result<(), String> { self.connected = true; Ok(()) }
        fn disconnect(&mut self) -> Result<(), String> { self.connected = false; Ok(()) }
        fn is_connected(&self) -> bool { self.connected }
    }
    fn node(id: &str, ms: Option<u64>, reachable: Option<bool>) -> Node {
        Node { id: id.into(), uri: "vless://example".into(), protocol: "vless".into(),
            measured_latency: ms.map(Duration::from_millis), reachable }
    }
    #[test]
    fn ranking_requires_actual_reachability() {
        let nodes = vec![node("unverified", Some(1), None),node("slow",Some(200),Some(true)),node("fast",Some(40),Some(true))];
        assert_eq!(select_best(&nodes).unwrap().id, "fast");
    }
    #[test]
    fn connection_state_tracks_backend() {
        let mut controller = NilController::new(Mock {connected:false});
        controller.connect(&node("a",None,None)).unwrap();
        assert!(matches!(controller.state,ConnectionState::Connected {..}));
        controller.disconnect().unwrap();
        assert_eq!(controller.state,ConnectionState::Disconnected);
    }
    #[test]
    fn dedup_and_protocol_limits() {
        let nodes=vec![node("a",None,None),node("a",None,None),node("b",None,None)];
        assert_eq!(limit_per_protocol(deduplicate(nodes),1).len(),1);
    }
}
