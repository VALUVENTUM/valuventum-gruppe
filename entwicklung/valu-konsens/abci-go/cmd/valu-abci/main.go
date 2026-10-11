// Command valu-abci implements the real CometBFT v0.38 ABCI++ socket wire
// protocol and delegates VALU demo-state execution to the existing JS core.
// The two processes run on ONE trusted machine; not a production ledger.
package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/cometbft/cometbft/abci/server"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/version"
)

const demoChainID = "VALUVENTUM-LOCAL-DEMO-7"

type workerBridge struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	seq    int64
}

type reply struct {
	ID     int64           `json:"id"`
	OK     bool            `json:"ok"`
	Error  string          `json:"error"`
	Result json.RawMessage `json:"result"`
}

func startWorker(nodeBinary, workerFile, stateDir, genesisFile string) (*workerBridge, error) {
	cmd := exec.Command(nodeBinary, workerFile, "--state-dir", stateDir, "--genesis", genesisFile)
	cmd.Stderr = os.Stderr
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	b := &workerBridge{cmd: cmd, stdin: in, stdout: bufio.NewReaderSize(out, 2*1024*1024)}
	var info struct {
		Height int64 `json:"height"`
	}
	if err = b.call("info", nil, &info); err != nil {
		b.close()
		return nil, fmt.Errorf("JS worker startup failed: %w", err)
	}
	return b, nil
}

func (b *workerBridge) close() {
	_ = b.stdin.Close()
	if b.cmd.Process != nil {
		_ = b.cmd.Process.Kill()
		_ = b.cmd.Wait()
	}
}

func (b *workerBridge) call(method string, fields map[string]interface{}, result interface{}) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if fields == nil {
		fields = make(map[string]interface{})
	}
	b.seq++
	fields["id"] = b.seq
	fields["method"] = method
	data, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if _, err = b.stdin.Write(data); err != nil {
		return fmt.Errorf("node write %s: %w", method, err)
	}
	line, err := b.stdout.ReadBytes('\n')
	if err != nil {
		return fmt.Errorf("node read %s: %w", method, err)
	}
	if len(line) > 2*1024*1024 {
		return errors.New("worker response too large")
	}
	var msg reply
	if err = json.Unmarshal(line, &msg); err != nil {
		return fmt.Errorf("invalid worker response: %w", err)
	}
	if msg.ID != b.seq {
		return errors.New("mismatched worker reply id")
	}
	if !msg.OK {
		return fmt.Errorf("JS worker %s: %s", method, msg.Error)
	}
	if result != nil {
		return json.Unmarshal(msg.Result, result)
	}
	return nil
}

type valuApp struct {
	abci.BaseApplication
	backend *workerBridge
}

func (a *valuApp) Info(_ context.Context, _ *abci.RequestInfo) (*abci.ResponseInfo, error) {
	var out struct {
		Height  int64  `json:"height"`
		AppHash string `json:"appHash"`
	}
	if err := a.backend.call("info", nil, &out); err != nil {
		return nil, err
	}
	h, err := hex.DecodeString(out.AppHash)
	if err != nil {
		return nil, err
	}
	return &abci.ResponseInfo{Data: "VALUVENTUM synthetic ABCI demo only", Version: version.ABCIVersion, AppVersion: 1, LastBlockHeight: out.Height, LastBlockAppHash: h}, nil
}
func (a *valuApp) InitChain(_ context.Context, req *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
	if req.ChainId != demoChainID {
		return nil, fmt.Errorf("wrong demo chain ID: %q", req.ChainId)
	}
	var out struct {
		AppHash string `json:"appHash"`
	}
	if err := a.backend.call("init", map[string]interface{}{"chainId": req.ChainId, "initialHeight": req.InitialHeight}, &out); err != nil {
		return nil, err
	}
	h, err := hex.DecodeString(out.AppHash)
	if err != nil {
		return nil, err
	}
	return &abci.ResponseInitChain{AppHash: h}, nil
}
func (a *valuApp) CheckTx(_ context.Context, req *abci.RequestCheckTx) (*abci.ResponseCheckTx, error) {
	var out struct {
		Code uint32 `json:"code"`
		Log  string `json:"log"`
	}
	if err := a.backend.call("check", map[string]interface{}{"tx": base64.StdEncoding.EncodeToString(req.Tx), "blockTime": time.Now().Unix()}, &out); err != nil {
		return nil, err
	}
	return &abci.ResponseCheckTx{Code: out.Code, Log: out.Log, GasWanted: 1}, nil
}
func encodeTxs(txs [][]byte) []string {
	out := make([]string, len(txs))
	for i, tx := range txs {
		out[i] = base64.StdEncoding.EncodeToString(tx)
	}
	return out
}
func decodeTxs(txs []string) ([][]byte, error) {
	out := make([][]byte, len(txs))
	for i, tx := range txs {
		v, err := base64.StdEncoding.DecodeString(tx)
		if err != nil {
			return nil, err
		}
		out[i] = v
	}
	return out, nil
}
func (a *valuApp) PrepareProposal(_ context.Context, req *abci.RequestPrepareProposal) (*abci.ResponsePrepareProposal, error) {
	var out struct {
		Txs []string `json:"txs"`
	}
	data := map[string]interface{}{"txs": encodeTxs(req.Txs), "height": req.Height, "blockTime": req.Time.Unix(), "maxBytes": req.MaxTxBytes}
	if err := a.backend.call("prepare", data, &out); err != nil {
		return nil, err
	}
	wire, err := decodeTxs(out.Txs)
	if err != nil {
		return nil, err
	}
	return &abci.ResponsePrepareProposal{Txs: wire}, nil
}
func (a *valuApp) ProcessProposal(_ context.Context, req *abci.RequestProcessProposal) (*abci.ResponseProcessProposal, error) {
	var out struct {
		Accept bool `json:"accept"`
	}
	data := map[string]interface{}{"txs": encodeTxs(req.Txs), "height": req.Height, "blockTime": req.Time.Unix()}
	if err := a.backend.call("process", data, &out); err != nil {
		return nil, err
	}
	if out.Accept {
		return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_ACCEPT}, nil
	}
	return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
}
func (a *valuApp) FinalizeBlock(_ context.Context, req *abci.RequestFinalizeBlock) (*abci.ResponseFinalizeBlock, error) {
	var out struct {
		AppHash string `json:"appHash"`
		Results []struct {
			Code uint32 `json:"code"`
			Log  string `json:"log"`
		} `json:"results"`
	}
	data := map[string]interface{}{"txs": encodeTxs(req.Txs), "height": req.Height, "blockTime": req.Time.Unix()}
	if err := a.backend.call("finalize", data, &out); err != nil {
		return nil, err
	}
	if len(out.Results) != len(req.Txs) {
		return nil, errors.New("wrong number of per-tx results")
	}
	h, err := hex.DecodeString(out.AppHash)
	if err != nil {
		return nil, err
	}
	results := make([]*abci.ExecTxResult, len(out.Results))
	for i, v := range out.Results {
		results[i] = &abci.ExecTxResult{Code: v.Code, Log: v.Log, GasUsed: 1}
	}
	return &abci.ResponseFinalizeBlock{AppHash: h, TxResults: results}, nil
}
func (a *valuApp) Commit(_ context.Context, _ *abci.RequestCommit) (*abci.ResponseCommit, error) {
	if err := a.backend.call("commit", nil, nil); err != nil {
		return nil, err
	}
	return &abci.ResponseCommit{}, nil
}
func (a *valuApp) Query(_ context.Context, req *abci.RequestQuery) (*abci.ResponseQuery, error) {
	var out struct {
		Code  uint32 `json:"code"`
		Log   string `json:"log"`
		Value string `json:"value"`
	}
	if err := a.backend.call("query", map[string]interface{}{"path": req.Path}, &out); err != nil {
		return nil, err
	}
	return &abci.ResponseQuery{Code: out.Code, Log: out.Log, Value: []byte(out.Value)}, nil
}
func (a *valuApp) ExtendVote(_ context.Context, _ *abci.RequestExtendVote) (*abci.ResponseExtendVote, error) {
	return &abci.ResponseExtendVote{}, nil
}
func (a *valuApp) VerifyVoteExtension(_ context.Context, req *abci.RequestVerifyVoteExtension) (*abci.ResponseVerifyVoteExtension, error) {
	if len(req.VoteExtension) > 0 {
		return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil
	}
	return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_ACCEPT}, nil
}

func main() {
	address := flag.String("listen", "tcp://127.0.0.1:26658", "CometBFT ABCI listen address (loopback only)")
	nodeBin := flag.String("node", "node", "Node.js executable")
	worker := flag.String("worker", "src/abci-worker.mjs", "JS worker path")
	stateDir := flag.String("state-dir", "./data/valu-application", "test state directory")
	genesisFile := flag.String("genesis", "./data/demo-genesis.json", "demo genesis without secret keys")
	flag.Parse()
	if *address != "tcp://127.0.0.1:26658" && *address != "tcp://localhost:26658" {
		fmt.Fprintln(os.Stderr, "DEMO protocol is restricted to loopback:26658")
		os.Exit(2)
	}
	backend, err := startWorker(*nodeBin, *worker, *stateDir, *genesisFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer backend.close()
	service := server.NewSocketServer(*address, &valuApp{backend: backend})
	if err = service.Start(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Fprintln(os.Stderr, "VALU-DEMO ABCI socket listening on", *address)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	if err = service.Stop(); err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
}