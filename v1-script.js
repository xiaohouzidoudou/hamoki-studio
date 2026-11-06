// ===== 全局状态 =====
const state = {
    mode: 'text2img', // 'text2img' | 'img2img'
    model: 'haiyinb2.1',
    prompt: '',
    referenceImage: null,
    resolution: '1k',
    ratio: '16:9',
    count: 1,
    zoom: 1,
    canvasImages: [],
    selectedImage: null,
    currentTool: 'select',
    isDraggingCanvas: false,
    isDraggingImage: false,
    dragStartPos: { x: 0, y: 0 }
};

// ===== DOM 元素 =====
const elements = {
    canvas: document.getElementById('canvas'),
    canvasViewport: document.getElementById('canvas-viewport'),
    zoomLevel: document.querySelector('.zoom-level'),

    // 工具按钮
    toolBtns: document.querySelectorAll('.tool-btn[data-tool]'),

    // 模式切换
    modeBtns: document.querySelectorAll('.mode-btn'),

    // 参数控件
    modelSelect: document.getElementById('model-select'),
    promptInput: document.getElementById('prompt'),
    promptCount: document.getElementById('prompt-count'),
    referenceSection: document.getElementById('reference-section'),
    referenceInput: document.getElementById('reference-input'),
    uploadReferenceBtn: document.getElementById('upload-reference'),
    referencePreview: document.getElementById('reference-preview'),

    // 分辨率、比例、数量
    resBtns: document.querySelectorAll('.res-btn'),
    ratioBtns: document.querySelectorAll('.ratio-btn'),
    countBtns: document.querySelectorAll('.count-btn'),

    // 生成按钮
    generateBtn: document.getElementById('generate-btn'),

    // 画布控制
    fitCanvasBtn: document.getElementById('fit-canvas'),
    clearCanvasBtn: document.getElementById('clear-canvas')
};

// ===== 工具栏交互 =====
elements.toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentTool = btn.dataset.tool;
        updateCursor();
    });
});

function updateCursor() {
    const viewport = elements.canvasViewport;
    switch (state.currentTool) {
        case 'hand':
            viewport.style.cursor = 'grab';
            break;
        case 'select':
            viewport.style.cursor = 'default';
            break;
        default:
            viewport.style.cursor = 'default';
    }
}

// ===== 模式切换 =====
elements.modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;

        // 显示/隐藏参考图部分
        if (state.mode === 'img2img') {
            elements.referenceSection.style.display = 'block';
        } else {
            elements.referenceSection.style.display = 'none';
        }
    });
});

// ===== 模型选择 =====
elements.modelSelect.addEventListener('change', (e) => {
    state.model = e.target.value;
});

// ===== 提示词输入 =====
elements.promptInput.addEventListener('input', (e) => {
    state.prompt = e.target.value;
    elements.promptCount.textContent = e.target.value.length;
});

// ===== 参考图上传 =====
elements.uploadReferenceBtn.addEventListener('click', () => {
    elements.referenceInput.click();
});

elements.referenceInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            state.referenceImage = event.target.result;
            showReferencePreview(event.target.result);
        };
        reader.readAsDataURL(file);
    }
});

function showReferencePreview(src) {
    elements.referencePreview.innerHTML = `
        <img src="${src}" alt="参考图">
        <button class="remove-btn" onclick="removeReference()">×</button>
    `;
    elements.referencePreview.classList.add('has-image');
}

function removeReference() {
    state.referenceImage = null;
    elements.referencePreview.innerHTML = '';
    elements.referencePreview.classList.remove('has-image');
    elements.referenceInput.value = '';
}

// ===== 分辨率选择 =====
elements.resBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.resBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.resolution = btn.dataset.res;
    });
});

// ===== 比例选择 =====
elements.ratioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.ratioBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.ratio = btn.dataset.ratio;
    });
});

// ===== 数量选择 =====
elements.countBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.countBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.count = parseInt(btn.dataset.count);
    });
});

// ===== 生成图片 =====
elements.generateBtn.addEventListener('click', () => {
    generateImages();
});

function generateImages() {
    // 显示生成中状态
    elements.generateBtn.disabled = true;
    elements.generateBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
        </svg>
        生成中...
    `;

    // 模拟生成图片（实际应该调用后端 API）
    setTimeout(() => {
        for (let i = 0; i < state.count; i++) {
            // 使用示例图片
            const sampleImages = [
                'https://picsum.photos/800/600?random=' + Math.random(),
                'https://picsum.photos/600/800?random=' + Math.random(),
                'https://picsum.photos/1024/768?random=' + Math.random()
            ];

            const randomImage = sampleImages[Math.floor(Math.random() * sampleImages.length)];
            addImageToCanvas(randomImage);
        }

        // 恢复按钮状态
        elements.generateBtn.disabled = false;
        elements.generateBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            生成图片
        `;
    }, 2000);
}

// ===== 画布图片管理 =====
function addImageToCanvas(src) {
    const id = 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    // 随机位置（避免重叠）
    const x = 100 + Math.random() * 300;
    const y = 100 + Math.random() * 200;

    // 根据比例计算尺寸
    const [w, h] = state.ratio.split(':').map(Number);
    const width = 300;
    const height = (width * h) / w;

    const imageData = {
        id,
        src,
        x,
        y,
        width,
        height
    };

    state.canvasImages.push(imageData);
    renderCanvasImage(imageData);
}

function renderCanvasImage(imageData) {
    const imgElement = document.createElement('div');
    imgElement.className = 'canvas-image';
    imgElement.dataset.id = imageData.id;
    imgElement.style.left = imageData.x + 'px';
    imgElement.style.top = imageData.y + 'px';
    imgElement.style.width = imageData.width + 'px';
    imgElement.style.height = imageData.height + 'px';

    imgElement.innerHTML = `
        <img src="${imageData.src}" alt="Generated">
        <button class="delete-btn" onclick="deleteCanvasImage('${imageData.id}')">×</button>
    `;

    // 图片交互事件
    imgElement.addEventListener('mousedown', (e) => handleImageMouseDown(e, imageData.id));
    imgElement.addEventListener('click', (e) => {
        if (state.currentTool === 'select') {
            selectImage(imageData.id);
        }
    });

    elements.canvas.appendChild(imgElement);
}

function selectImage(id) {
    // 取消其他选中
    document.querySelectorAll('.canvas-image').forEach(img => {
        img.classList.remove('selected');
    });

    // 选中当前图片
    const imgElement = document.querySelector(`[data-id="${id}"]`);
    if (imgElement) {
        imgElement.classList.add('selected');
        state.selectedImage = id;
    }
}

function deleteCanvasImage(id) {
    // 从状态中移除
    state.canvasImages = state.canvasImages.filter(img => img.id !== id);

    // 从 DOM 中移除
    const imgElement = document.querySelector(`[data-id="${id}"]`);
    if (imgElement) {
        imgElement.remove();
    }

    if (state.selectedImage === id) {
        state.selectedImage = null;
    }
}

// ===== 图片拖动 =====
function handleImageMouseDown(e, id) {
    if (state.currentTool !== 'select') return;

    e.stopPropagation();
    selectImage(id);

    state.isDraggingImage = true;
    state.dragStartPos = {
        x: e.clientX,
        y: e.clientY
    };

    const imageData = state.canvasImages.find(img => img.id === id);
    if (imageData) {
        state.dragStartPos.imgX = imageData.x;
        state.dragStartPos.imgY = imageData.y;
    }
}

// ===== 画布拖动和缩放 =====
elements.canvasViewport.addEventListener('mousedown', (e) => {
    if (state.currentTool === 'hand' || (e.button === 1)) { // 中键拖动
        state.isDraggingCanvas = true;
        state.dragStartPos = {
            x: e.clientX,
            y: e.clientY,
            scrollLeft: elements.canvasViewport.scrollLeft,
            scrollTop: elements.canvasViewport.scrollTop
        };
        elements.canvasViewport.style.cursor = 'grabbing';
        e.preventDefault();
    }
});

document.addEventListener('mousemove', (e) => {
    if (state.isDraggingCanvas) {
        const dx = e.clientX - state.dragStartPos.x;
        const dy = e.clientY - state.dragStartPos.y;

        elements.canvasViewport.scrollLeft = state.dragStartPos.scrollLeft - dx;
        elements.canvasViewport.scrollTop = state.dragStartPos.scrollTop - dy;
    }

    if (state.isDraggingImage && state.selectedImage) {
        const dx = e.clientX - state.dragStartPos.x;
        const dy = e.clientY - state.dragStartPos.y;

        const imageData = state.canvasImages.find(img => img.id === state.selectedImage);
        if (imageData) {
            imageData.x = state.dragStartPos.imgX + dx;
            imageData.y = state.dragStartPos.imgY + dy;

            const imgElement = document.querySelector(`[data-id="${state.selectedImage}"]`);
            if (imgElement) {
                imgElement.style.left = imageData.x + 'px';
                imgElement.style.top = imageData.y + 'px';
            }
        }
    }
});

document.addEventListener('mouseup', () => {
    if (state.isDraggingCanvas) {
        state.isDraggingCanvas = false;
        updateCursor();
    }
    if (state.isDraggingImage) {
        state.isDraggingImage = false;
    }
});

// 鼠标滚轮缩放
elements.canvasViewport.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        state.zoom = Math.max(0.1, Math.min(5, state.zoom * delta));

        elements.canvas.style.transform = `scale(${state.zoom})`;
        elements.zoomLevel.textContent = Math.round(state.zoom * 100) + '%';
    }
});

// ===== 画布控制按钮 =====
elements.fitCanvasBtn.addEventListener('click', () => {
    state.zoom = 1;
    elements.canvas.style.transform = 'scale(1)';
    elements.zoomLevel.textContent = '100%';
    elements.canvasViewport.scrollLeft = 0;
    elements.canvasViewport.scrollTop = 0;
});

elements.clearCanvasBtn.addEventListener('click', () => {
    if (confirm('确定要清空画布吗？')) {
        state.canvasImages = [];
        state.selectedImage = null;
        elements.canvas.innerHTML = '';
    }
});

// ===== 键盘快捷键 =====
document.addEventListener('keydown', (e) => {
    // Delete 或 Backspace 删除选中图片
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedImage) {
        e.preventDefault();
        deleteCanvasImage(state.selectedImage);
    }

    // Escape 取消选中
    if (e.key === 'Escape' && state.selectedImage) {
        document.querySelectorAll('.canvas-image').forEach(img => {
            img.classList.remove('selected');
        });
        state.selectedImage = null;
    }

    // 空格键切换到拖动工具
    if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (state.currentTool !== 'hand') {
            elements.toolBtns.forEach(btn => {
                if (btn.dataset.tool === 'hand') {
                    btn.click();
                }
            });
        }
    }
});

// ===== 添加旋转动画 CSS =====
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);

// ===== 初始化 =====
updateCursor();
console.log('Hamoki Studio V1 已加载');
