function providerActionModel(item = {}) {
  const provider = String(item.provider || '');
  const status = String(item.connectionStatus || 'expired');
  const logs = { key: 'logs', label: '查看日志', style: 'link' };

  if (provider !== 'IHG') {
    return {
      notice: '暂未接入真实同步，仅保留日志查看。',
      actions: [logs],
    };
  }

  if (status === 'remote_authorization_running') {
    return {
      notice: '远程授权进行中，请继续完成官方登录。',
      actions: [
        { key: 'continueAuthorization', label: '继续授权' },
        {
          key: 'stopAuthorization',
          label: '停止授权',
          style: 'secondary',
        },
        logs,
      ],
    };
  }

  if (status === 'session_authorized' || status === 'active') {
    return {
      notice:
        status === 'active'
          ? '真实数据同步已启用。'
          : 'Session 已保存，可以直接同步真实价格。',
      actions: [
        { key: 'test', label: '测试连接', style: 'secondary' },
        {
          key: 'sync',
          label:
            status === 'active' ? '重新同步90天价格' : '同步90天价格',
        },
        logs,
      ],
    };
  }

  return {
    notice: '需要先由管理员完成人工登录授权。',
    actions: [{ key: 'authorize', label: '开始 IHG 授权' }, logs],
  };
}

module.exports = {
  providerActionModel,
};
