/**
 * Hamoki Studio UI/UX L1+L2 Optimization
 * Level 1: Sidebar grouping, top toolbar, compact layout, quick templates
 * Level 2: First-time wizard, smart recommendations, batch operations, workflow modes
 */

(function() {
  'use strict';

  // ============================================================================
  // Level 1.1: Sidebar Section Collapse
  // ============================================================================
  
  function initSidebarSections() {
    const sections = document.querySelectorAll('.sidebar-section');
    
    // Load saved states from localStorage
    const savedStates = {};
    try {
      const saved = localStorage.getItem('hs-sidebar-sections');
      if (saved) Object.assign(savedStates, JSON.parse(saved));
    } catch (e) {}
    
    // Default: quick section expanded, pro section collapsed
    if (!savedStates.quick) savedStates.quick = 'expanded';
    if (!savedStates.pro) savedStates.pro = 'collapsed';
    
    sections.forEach(section => {
      const name = section.dataset.section;
      const toggle = section.querySelector('.section-toggle');
      const content = section.querySelector('.section-content');
      
      if (!toggle || !content) return;
      
      // Apply saved state
      const state = savedStates[name] || 'collapsed';
      if (state === 'expanded') {
        section.classList.add('expanded');
      } else {
        section.classList.remove('expanded');
      }
      
      // Toggle handler
      toggle.addEventListener('click', () => {
        const isExpanded = section.classList.toggle('expanded');
        savedStates[name] = isExpanded ? 'expanded' : 'collapsed';
        
        try {
          localStorage.setItem('hs-sidebar-sections', JSON.stringify(savedStates));
        } catch (e) {}
      });
    });
  }

  // ============================================================================
  // Level 1.2: Top Canvas Toolbar
  // ============================================================================
  
  function initTopToolbar() {
    const topToolbar = document.querySelector('.canvas-toolbar-top');
    if (!topToolbar) return;
    
    // Sync with existing tool system
    const tools = topToolbar.querySelectorAll('[data-tool]');
    tools.forEach(btn => {
      btn.addEventListener('click', () => {
        const toolName = btn.dataset.tool;
        
        // Remove active from all
        tools.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        
        // Trigger existing tool change
        if (window.setTool) {
          window.setTool(toolName);
        }
      });
    });
    
    // Upload canvas top button
    const uploadTop = document.getElementById('uploadCanvasTop');
    const canvasFiles = document.getElementById('canvasFiles');
    if (uploadTop && canvasFiles) {
      uploadTop.addEventListener('click', () => canvasFiles.click());
    }
  }

  // ============================================================================
  // Level 1.3: Generator Panel Compact Layout (already in HTML)
  // ============================================================================
  
  // Layout optimization handled by CSS and existing structure

  // ============================================================================
  // Level 1.4: Quick Provider Templates
  // ============================================================================
  
  function initQuickTemplates() {
    const settingsModal = document.getElementById('settingsModal');
    if (!settingsModal) return;
    
    // Add quick template button
    const formTitle = settingsModal.querySelector('#formTitle');
    if (!formTitle) return;
    
    const templateBtn = document.createElement('button');
    templateBtn.className = 'soft-btn quick-template-btn';
    templateBtn.type = 'button';
    templateBtn.innerHTML = '<svg class="icon sm"><use href="#ic-bolt"></use></svg> 快速配置';
    templateBtn.style.marginLeft = 'auto';
    
    formTitle.style.display = 'flex';
    formTitle.style.alignItems = 'center';
    formTitle.style.gap = '10px';
    formTitle.appendChild(templateBtn);
    
    templateBtn.addEventListener('click', showTemplateSelector);
  }
  
  function showTemplateSelector() {
    const templates = [
      {
        name: 'OpenAI 官方',
        url: 'https://api.openai.com/v1',
        mode: 'openai',
        imageMode: 'images',
        keyPlaceholder: 'sk-...'
      },
      {
        name: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1',
        mode: 'openai',
        imageMode: 'chat',
        keyPlaceholder: 'sk-or-...'
      },
      {
        name: 'DeepSeek',
        url: 'https://api.deepseek.com/v1',
        mode: 'openai',
        imageMode: 'chat',
        keyPlaceholder: 'sk-...'
      },
      {
        name: 'Cloudflare Workers AI',
        url: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1',
        mode: 'openai',
        imageMode: 'chat',
        keyPlaceholder: 'Bearer YOUR_API_TOKEN'
      }
    ];
    
    // Create template selector
    const overlay = document.createElement('div');
    overlay.className = 'template-overlay';
    overlay.innerHTML = `
      <div class="template-dialog">
        <div class="template-header">
          <h3>选择快速配置模板</h3>
          <button class="template-close" aria-label="关闭">×</button>
        </div>
        <div class="template-list">
          ${templates.map((t, i) => `
            <button class="template-item" data-index="${i}">
              <svg class="icon"><use href="#ic-bolt"></use></svg>
              <div>
                <strong>${t.name}</strong>
                <small>${t.url}</small>
              </div>
            </button>
          `).join('')}
        </div>
        <div class="template-footer">
          <small>选择后将自动填充 URL、协议和模式，仍需手动填写 API Key</small>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Close handler
    const close = () => {
      overlay.remove();
    };
    
    overlay.querySelector('.template-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    
    // Template selection
    overlay.querySelectorAll('.template-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const tpl = templates[idx];
        
        // Fill form
        const pfName = document.getElementById('pfName');
        const pfUrl = document.getElementById('pfUrl');
        const pfMode = document.getElementById('pfMode');
        const pfImageMode = document.getElementById('pfImageMode');
        
        if (pfName) pfName.value = tpl.name;
        if (pfUrl) pfUrl.value = tpl.url;
        if (pfMode) pfMode.value = tpl.mode;
        if (pfImageMode) pfImageMode.value = tpl.imageMode;
        
        close();
        
        // Show toast
        if (window.toast) {
          window.toast(`已填充 ${tpl.name} 配置，请输入 API Key`);
        }
      });
    });
  }

  // ============================================================================
  // Level 2.1: First-Time User Wizard
  // ============================================================================
  
  function checkFirstTimeUser() {
    try {
      const hasSeenWizard = localStorage.getItem('hs-wizard-completed');
      if (hasSeenWizard) return;
      
      // Check if user is logged in
      const checkInterval = setInterval(() => {
        if (window.authorized && window.currentUser) {
          clearInterval(checkInterval);
          setTimeout(() => showFirstTimeWizard(), 1000);
        }
      }, 500);
      
      // Timeout after 5 seconds
      setTimeout(() => clearInterval(checkInterval), 5000);
    } catch (e) {}
  }
  
  function showFirstTimeWizard() {
    const hasProviders = window.providers && window.providers.length > 0;
    if (hasProviders) {
      // User already has providers, skip wizard
      try {
        localStorage.setItem('hs-wizard-completed', 'true');
      } catch (e) {}
      return;
    }
    
    const wizard = document.createElement('div');
    wizard.className = 'wizard-overlay';
    wizard.innerHTML = `
      <div class="wizard-dialog">
        <div class="wizard-header">
          <div class="wizard-badge">
            <svg class="icon"><use href="#ic-spark"></use></svg>
          </div>
          <h2>欢迎使用 Hamoki Studio</h2>
          <p>3 步快速开始创作</p>
        </div>
        <div class="wizard-body">
          <div class="wizard-step active" data-step="1">
            <div class="wizard-step-number">步骤 1/3</div>
            <h3>配置第一个中转站</h3>
            <p>选择一个模板快速配置，或点击"跳过"稍后手动设置</p>
            <div class="wizard-templates">
              <button class="wizard-template-btn" data-template="openai">
                <strong>OpenAI 官方</strong>
                <small>api.openai.com</small>
              </button>
              <button class="wizard-template-btn" data-template="openrouter">
                <strong>OpenRouter</strong>
                <small>openrouter.ai</small>
              </button>
            </div>
          </div>
          <div class="wizard-step" data-step="2">
            <div class="wizard-step-number">步骤 2/3</div>
            <h3>上传第一张参考图</h3>
            <p>拖入图片或点击按钮上传，作为创作的起点</p>
            <button class="wizard-upload-btn">
              <svg class="icon"><use href="#ic-upload"></use></svg>
              <span>选择图片</span>
            </button>
          </div>
          <div class="wizard-step" data-step="3">
            <div class="wizard-step-number">步骤 3/3</div>
            <h3>完成第一次生图</h3>
            <p>输入创作描述，点击"开始生成"体验 AI 创作</p>
            <div class="wizard-prompt-demo">
              <textarea placeholder="例如：一个可爱的卡通猴子，穿着宇航服，在太空漂浮" rows="3" readonly></textarea>
              <button class="wizard-demo-btn">开始生成</button>
            </div>
          </div>
        </div>
        <div class="wizard-footer">
          <div class="wizard-progress">
            <div class="wizard-dot active"></div>
            <div class="wizard-dot"></div>
            <div class="wizard-dot"></div>
          </div>
          <div class="wizard-actions">
            <button class="soft-btn wizard-skip">跳过向导</button>
            <button class="primary-btn wizard-next">下一步</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(wizard);
    
    let currentStep = 1;
    const totalSteps = 3;
    
    const updateWizardUI = () => {
      wizard.querySelectorAll('.wizard-step').forEach(step => {
        step.classList.toggle('active', parseInt(step.dataset.step) === currentStep);
      });
      
      wizard.querySelectorAll('.wizard-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx < currentStep);
      });
      
      const nextBtn = wizard.querySelector('.wizard-next');
      if (currentStep === totalSteps) {
        nextBtn.textContent = '完成';
      } else {
        nextBtn.textContent = '下一步';
      }
    };
    
    // Template selection
    wizard.querySelectorAll('.wizard-template-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Open settings and fill template
        if (window.openSettings) {
          window.openSettings();
        }
        const templateType = btn.dataset.template;
        // Auto-advance to step 2
        currentStep = 2;
        updateWizardUI();
      });
    });
    
    // Upload handler
    const uploadBtn = wizard.querySelector('.wizard-upload-btn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        const canvasFiles = document.getElementById('canvasFiles');
        if (canvasFiles) canvasFiles.click();
        // Auto-advance to step 3
        setTimeout(() => {
          currentStep = 3;
          updateWizardUI();
        }, 300);
      });
    }
    
    // Next button
    wizard.querySelector('.wizard-next').addEventListener('click', () => {
      if (currentStep < totalSteps) {
        currentStep++;
        updateWizardUI();
      } else {
        // Complete wizard
        try {
          localStorage.setItem('hs-wizard-completed', 'true');
        } catch (e) {}
        wizard.remove();
      }
    });
    
    // Skip button
    wizard.querySelector('.wizard-skip').addEventListener('click', () => {
      try {
        localStorage.setItem('hs-wizard-completed', 'true');
      } catch (e) {}
      wizard.remove();
    });
  }

  // ============================================================================
  // Level 2.2: Smart Model Recommendations
  // ============================================================================
  
  function enhanceModelSelector() {
    // This will be integrated into the existing model menu
    // Add "推荐" tags to appropriate models based on task
    
    // Hook into model menu rendering
    const observeModelMenu = () => {
      const menu = document.getElementById('composerModelMenu');
      if (!menu) return;
      
      const observer = new MutationObserver(() => {
        addModelRecommendations();
      });
      
      observer.observe(menu, { childList: true, subtree: true });
    };
    
    observeModelMenu();
  }
  
  function addModelRecommendations() {
    const menu = document.getElementById('composerModelMenu');
    if (!menu || menu.classList.contains('hidden')) return;
    
    const options = menu.querySelectorAll('.composer-model-option');
    
    options.forEach(opt => {
      const modelName = opt.querySelector('.composer-model-name')?.textContent || '';
      const lowerName = modelName.toLowerCase();
      
      // Remove existing recommendation tags
      const existingTag = opt.querySelector('.model-recommend-tag');
      if (existingTag) existingTag.remove();
      
      let recommendReason = '';
      
      // Recommendation logic
      if (lowerName.includes('dall-e') || lowerName.includes('dalle')) {
        recommendReason = '推荐：文生图';
      } else if (lowerName.includes('flux') || lowerName.includes('sd3')) {
        recommendReason = '推荐：高质量';
      } else if (lowerName.includes('turbo') || lowerName.includes('lightning')) {
        recommendReason = '推荐：快速';
      }
      
      if (recommendReason) {
        const tag = document.createElement('span');
        tag.className = 'model-recommend-tag';
        tag.textContent = recommendReason;
        opt.appendChild(tag);
      }
    });
  }

  // ============================================================================
  // Level 2.3: Batch Operations Toolbar
  // ============================================================================
  
  function enhanceBatchOperations() {
    // Hook into multi-selection
    const checkMultiSelection = () => {
      if (!window.multiNodeIds) return;
      
      const count = window.multiNodeIds.size;
      if (count > 1) {
        showBatchToolbar(count);
      } else {
        hideBatchToolbar();
      }
    };
    
    // Poll for multi-selection changes
    setInterval(checkMultiSelection, 200);
  }
  
  function showBatchToolbar(count) {
    let toolbar = document.getElementById('batchOperationsToolbar');
    
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'batchOperationsToolbar';
      toolbar.className = 'batch-operations-toolbar';
      toolbar.innerHTML = `
        <div class="batch-toolbar-info">
          <span>已选择 <strong id="batchCount">${count}</strong> 个对象</span>
        </div>
        <button class="batch-btn" data-batch="align-left">
          <svg class="icon sm"><use href="#ic-arrow"></use></svg>
          左对齐
        </button>
        <button class="batch-btn" data-batch="align-top">
          <svg class="icon sm"><use href="#ic-arrow"></use></svg>
          顶部对齐
        </button>
        <button class="batch-btn" data-batch="distribute-h">
          <svg class="icon sm"><use href="#ic-layers"></use></svg>
          水平均分
        </button>
        <button class="batch-btn" data-batch="distribute-v">
          <svg class="icon sm"><use href="#ic-layers"></use></svg>
          垂直均分
        </button>
        <button class="batch-btn" data-batch="download">
          <svg class="icon sm"><use href="#ic-download"></use></svg>
          批量下载
        </button>
        <button class="batch-btn batch-danger" data-batch="delete">
          <svg class="icon sm"><use href="#ic-trash"></use></svg>
          删除
        </button>
      `;
      
      const board = document.getElementById('board');
      if (board) {
        board.appendChild(toolbar);
      }
      
      // Event handlers
      toolbar.querySelectorAll('[data-batch]').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.batch;
          handleBatchOperation(action);
        });
      });
    }
    
    const countEl = toolbar.querySelector('#batchCount');
    if (countEl) countEl.textContent = count;
    
    toolbar.classList.remove('hidden');
    
    // Position above selected nodes
    positionBatchToolbar(toolbar);
  }
  
  function hideBatchToolbar() {
    const toolbar = document.getElementById('batchOperationsToolbar');
    if (toolbar) {
      toolbar.classList.add('hidden');
    }
  }
  
  function positionBatchToolbar(toolbar) {
    if (!window.currentProject || !window.multiNodeIds) return;
    
    const nodes = Array.from(window.multiNodeIds).map(id => 
      window.currentProject.nodes.find(n => n.id === id)
    ).filter(Boolean);
    
    if (nodes.length === 0) return;
    
    // Calculate bounding box
    let minX = Infinity, minY = Infinity;
    nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
    });
    
    // Transform to screen coordinates
    const cam = window.cam || { x: 0, y: 0, scale: 1 };
    const screenX = (minX + cam.x) * cam.scale;
    const screenY = (minY + cam.y) * cam.scale - 80; // Above selection
    
    toolbar.style.left = `${screenX}px`;
    toolbar.style.top = `${screenY}px`;
  }
  
  function handleBatchOperation(action) {
    if (!window.multiNodeIds || window.multiNodeIds.size === 0) return;
    
    const nodeIds = Array.from(window.multiNodeIds);
    
    switch (action) {
      case 'align-left':
        alignNodes(nodeIds, 'left');
        break;
      case 'align-top':
        alignNodes(nodeIds, 'top');
        break;
      case 'distribute-h':
        distributeNodes(nodeIds, 'horizontal');
        break;
      case 'distribute-v':
        distributeNodes(nodeIds, 'vertical');
        break;
      case 'download':
        batchDownload(nodeIds);
        break;
      case 'delete':
        batchDelete(nodeIds);
        break;
    }
  }
  
  function alignNodes(nodeIds, direction) {
    if (!window.currentProject) return;
    
    const nodes = nodeIds.map(id => 
      window.currentProject.nodes.find(n => n.id === id)
    ).filter(Boolean);
    
    if (nodes.length < 2) return;
    
    if (direction === 'left') {
      const minX = Math.min(...nodes.map(n => n.x));
      nodes.forEach(n => n.x = minX);
    } else if (direction === 'top') {
      const minY = Math.min(...nodes.map(n => n.y));
      nodes.forEach(n => n.y = minY);
    }
    
    if (window.saveProjectThrottled) {
      window.saveProjectThrottled();
    }
    if (window.renderScene) {
      window.renderScene();
    }
  }
  
  function distributeNodes(nodeIds, direction) {
    if (!window.currentProject) return;
    
    const nodes = nodeIds.map(id => 
      window.currentProject.nodes.find(n => n.id === id)
    ).filter(Boolean);
    
    if (nodes.length < 3) return;
    
    if (direction === 'horizontal') {
      nodes.sort((a, b) => a.x - b.x);
      const first = nodes[0].x;
      const last = nodes[nodes.length - 1].x;
      const gap = (last - first) / (nodes.length - 1);
      nodes.forEach((n, i) => n.x = first + gap * i);
    } else {
      nodes.sort((a, b) => a.y - b.y);
      const first = nodes[0].y;
      const last = nodes[nodes.length - 1].y;
      const gap = (last - first) / (nodes.length - 1);
      nodes.forEach((n, i) => n.y = first + gap * i);
    }
    
    if (window.saveProjectThrottled) {
      window.saveProjectThrottled();
    }
    if (window.renderScene) {
      window.renderScene();
    }
  }
  
  function batchDownload(nodeIds) {
    // Trigger download for each node
    nodeIds.forEach((id, index) => {
      setTimeout(() => {
        const node = window.currentProject?.nodes.find(n => n.id === id);
        if (!node) return;
        
        const url = window.nodeImage?.(node);
        if (!url) return;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `hamoki-${id}.png`;
        a.click();
      }, index * 200); // Stagger downloads
    });
    
    if (window.toast) {
      window.toast(`正在下载 ${nodeIds.length} 张图片...`);
    }
  }
  
  function batchDelete(nodeIds) {
    if (!confirm(`确定要删除选中的 ${nodeIds.length} 个对象吗？`)) return;
    
    if (!window.currentProject) return;
    
    nodeIds.forEach(id => {
      const idx = window.currentProject.nodes.findIndex(n => n.id === id);
      if (idx >= 0) {
        window.currentProject.nodes.splice(idx, 1);
      }
    });
    
    window.multiNodeIds?.clear();
    
    if (window.saveProjectThrottled) {
      window.saveProjectThrottled();
    }
    if (window.renderScene) {
      window.renderScene();
    }
    
    if (window.toast) {
      window.toast(`已删除 ${nodeIds.length} 个对象`);
    }
  }

  // ============================================================================
  // Level 2.4: Workflow Mode Switcher
  // ============================================================================
  
  function initWorkflowModes() {
    // Add mode switcher to assistant panel
    const assistantPanel = document.getElementById('assistantPanel');
    if (!assistantPanel) return;
    
    // Check if already exists
    if (document.getElementById('workflowModeSwitcher')) return;
    
    const switcher = document.createElement('div');
    switcher.id = 'workflowModeSwitcher';
    switcher.className = 'workflow-mode-switcher';
    switcher.innerHTML = `
      <button class="workflow-mode active" data-mode="quick">
        <svg class="icon"><use href="#ic-bolt"></use></svg>
        <span>快速模式</span>
      </button>
      <button class="workflow-mode" data-mode="pro">
        <svg class="icon"><use href="#ic-settings"></use></svg>
        <span>专业模式</span>
      </button>
    `;
    
    // Insert before model config
    const modelConfig = assistantPanel.querySelector('.model-config');
    if (modelConfig) {
      modelConfig.parentNode.insertBefore(switcher, modelConfig);
    }
    
    // Mode switching
    switcher.querySelectorAll('.workflow-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        switcher.querySelectorAll('.workflow-mode').forEach(b => 
          b.classList.remove('active')
        );
        btn.classList.add('active');
        
        const mode = btn.dataset.mode;
        applyWorkflowMode(mode);
      });
    });
    
    // Apply default mode
    const savedMode = localStorage.getItem('hs-workflow-mode') || 'quick';
    applyWorkflowMode(savedMode);
  }
  
  function applyWorkflowMode(mode) {
    try {
      localStorage.setItem('hs-workflow-mode', mode);
    } catch (e) {}
    
    const advanced = document.getElementById('advanced');
    const moreSettings = document.getElementById('moreSettings');
    
    if (mode === 'quick') {
      // Hide advanced options
      if (advanced) advanced.classList.add('hidden');
      if (moreSettings) moreSettings.style.display = 'none';
      
      // Show only essential params
      document.querySelectorAll('.params-row label').forEach(label => {
        const select = label.querySelector('select');
        if (select) {
          const isEssential = ['ratio', 'amount'].includes(select.id);
          label.style.display = isEssential ? '' : 'none';
        }
      });
    } else {
      // Show all options
      if (moreSettings) moreSettings.style.display = '';
      
      document.querySelectorAll('.params-row label').forEach(label => {
        label.style.display = '';
      });
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================
  
  function init() {
    // Wait for DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    
    console.log('Initializing UI/UX L1+L2 Optimizations...');
    
    // Level 1
    initSidebarSections();
    initTopToolbar();
    initQuickTemplates();
    
    // Level 2
    setTimeout(() => {
      checkFirstTimeUser();
      enhanceModelSelector();
      enhanceBatchOperations();
      initWorkflowModes();
    }, 1000);
  }
  
  // Start initialization
  init();
  
  // Expose for debugging
  window.HamokiUIOptimization = {
    showFirstTimeWizard,
    showTemplateSelector,
    applyWorkflowMode
  };
  
})();
