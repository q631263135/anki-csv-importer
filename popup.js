// AnkiConnect API 调用
class AnkiConnect {
    constructor(url = 'http://localhost:8765') {
        this.url = url;
    }

    async invoke(action, params = {}) {
        try {
            const response = await fetch(this.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action,
                    version: 6,
                    params
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.error) {
                throw new Error(result.error);
            }
            return result.result;
        } catch (error) {
            if (error.message.includes('Failed to fetch')) {
                throw new Error('无法连接到 AnkiConnect。请确保：\n1. Anki 已启动\n2. 已安装 AnkiConnect 插件\n3. AnkiConnect 正在运行');
            }
            throw error;
        }
    }

    async testConnection() {
        try {
            const version = await this.invoke('version');
            return { success: true, version };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getDeckNames() {
        return await this.invoke('deckNames');
    }

    async getModelNames() {
        return await this.invoke('modelNames');
    }

    async getModelFieldNames(modelName) {
        return await this.invoke('modelFieldNames', { modelName });
    }

    async addNote(note) {
        return await this.invoke('addNote', { note });
    }

    async updateNoteFields(id, fields) {
        return await this.invoke('updateNoteFields', {
            note: { id, fields }
        });
    }

    async findNotes(query) {
        return await this.invoke('findNotes', { query });
    }

    async notesInfo(notes) {
        return await this.invoke('notesInfo', { notes });
    }

    async addTags(notes, tags) {
        return await this.invoke('addTags', { notes, tags });
    }
}

// CSV 解析器
class CSVParser {
    constructor(delimiter = ',') {
        this.delimiter = delimiter;
    }

    parse(text) {
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length === 0) return { headers: [], rows: [] };

        const headers = this.parseLine(lines[0]);
        const rows = lines.slice(1).map(line => this.parseLine(line));

        return { headers, rows: rows.filter(row => row.some(cell => cell.trim())) };
    }

    parseLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === this.delimiter && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current);
        return result;
    }
}

// 主应用
class AnkiImporter {
    constructor() {
        this.anki = null;
        this.csvData = null;
        this.parsedData = null;
        this.currentModelFields = [];
        this.fieldMappings = {}; // 存储字段映射
        this.initElements();
        this.initEventListeners();
        this.loadSettings();
    }

    initElements() {
        this.elements = {
            // 选项卡
            tabBtns: document.querySelectorAll('.tab-btn'),
            pasteTab: document.getElementById('pasteTab'),
            fileTab: document.getElementById('fileTab'),

            // 输入
            csvText: document.getElementById('csvText'),
            parseBtn: document.getElementById('parseBtn'),
            csvFile: document.getElementById('csvFile'),
            fileName: document.getElementById('fileName'),
            delimiter: document.getElementById('delimiter'),
            allowHtml: document.getElementById('allowHtml'),

            // 预览
            preview: document.getElementById('preview'),
            previewTable: document.getElementById('previewTable'),
            totalRows: document.getElementById('totalRows'),

            // 选项
            noteType: document.getElementById('noteType'),
            deck: document.getElementById('deck'),
            duplicatePolicy: document.getElementById('duplicatePolicy'),
            tagAll: document.getElementById('tagAll'),
            tagUpdated: document.getElementById('tagUpdated'),

            // 字段映射
            currentModel: document.getElementById('currentModel'),
            fieldMappings: document.getElementById('fieldMappings'),

            // 操作
            importBtn: document.getElementById('importBtn'),
            status: document.getElementById('status'),
            progress: document.getElementById('progress'),
            progressFill: document.getElementById('progressFill'),
            progressText: document.getElementById('progressText'),

            // 设置
            ankiUrl: document.getElementById('ankiUrl'),
            testConnection: document.getElementById('testConnection')
        };
    }

    initEventListeners() {
        // 选项卡切换
        this.elements.tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // CSV 输入
        this.elements.parseBtn.addEventListener('click', () => this.parseCSVText());
        this.elements.csvText.addEventListener('input', () => {
            if (this.elements.csvText.value.trim()) {
                this.elements.parseBtn.disabled = false;
            }
        });

        this.elements.csvFile.addEventListener('change', (e) => this.handleFileSelect(e));
        this.elements.delimiter.addEventListener('change', () => this.reloadPreview());

        // 模板变化时重新加载字段
        this.elements.noteType.addEventListener('change', () => this.onModelChange());

        // 导入和测试
        this.elements.importBtn.addEventListener('click', () => this.importToAnki());
        this.elements.testConnection.addEventListener('click', () => this.testAnkiConnection());
        this.elements.ankiUrl.addEventListener('change', (e) => this.updateAnkiUrl(e.target.value));
    }

    switchTab(tab) {
        // 更新按钮状态
        this.elements.tabBtns.forEach(btn => {
            if (btn.dataset.tab === tab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 更新内容显示
        this.elements.pasteTab.classList.toggle('active', tab === 'paste');
        this.elements.fileTab.classList.toggle('active', tab === 'file');
    }

    async loadSettings() {
        const result = await chrome.storage.local.get(['ankiUrl', 'lastDeck', 'lastModel']);
        if (result.ankiUrl) {
            this.elements.ankiUrl.value = result.ankiUrl;
        }
        this.anki = new AnkiConnect(this.elements.ankiUrl.value);

        // 加载牌组和模板
        await this.loadDecksAndModels();

        // 恢复上次选择
        if (result.lastDeck && this.elements.deck.querySelector(`option[value="${result.lastDeck}"]`)) {
            this.elements.deck.value = result.lastDeck;
        }
        if (result.lastModel && this.elements.noteType.querySelector(`option[value="${result.lastModel}"]`)) {
            this.elements.noteType.value = result.lastModel;
            await this.onModelChange();
        }
    }

    async loadDecksAndModels() {
        try {
            this.showStatus('正在加载 Anki 数据...', 'info');

            // 并行加载牌组和模板
            const [decks, models] = await Promise.all([
                this.anki.getDeckNames(),
                this.anki.getModelNames()
            ]);

            // 填充牌组下拉框
            this.elements.deck.innerHTML = decks.map(deck =>
                `<option value="${this.escapeHtml(deck)}">${this.escapeHtml(deck)}</option>`
            ).join('');

            // 填充模板下拉框
            this.elements.noteType.innerHTML = models.map(model =>
                `<option value="${this.escapeHtml(model)}">${this.escapeHtml(model)}</option>`
            ).join('');

            // 尝试选择包含自定义字段的模板
            const customModel = models.find(m =>
                m.toLowerCase().includes('custom') ||
                m.toLowerCase().includes('basic')
            );
            if (customModel) {
                this.elements.noteType.value = customModel;
            }

            await this.onModelChange();

            this.showStatus('✓ 已连接到 Anki', 'success');
            setTimeout(() => {
                this.elements.status.style.display = 'none';
            }, 2000);
        } catch (error) {
            console.error('Failed to load decks and models:', error);
            this.showStatus(`✗ ${error.message}`, 'error');
            this.elements.deck.innerHTML = '<option value="">无法加载牌组</option>';
            this.elements.noteType.innerHTML = '<option value="">无法加载模板</option>';
        }
    }

    async onModelChange() {
        const modelName = this.elements.noteType.value;
        if (!modelName) return;

        try {
            // 获取模板的字段
            this.currentModelFields = await this.anki.getModelFieldNames(modelName);

            // 更新显示的模板名称
            this.elements.currentModel.textContent = modelName;

            // 保存选择
            await chrome.storage.local.set({ lastModel: modelName });

            // 重新生成字段映射UI
            this.generateFieldMappingUI();

            console.log('Model fields:', this.currentModelFields);
        } catch (error) {
            console.error('Failed to load model fields:', error);
            this.showStatus(`✗ 无法加载模板字段: ${error.message}`, 'error');
        }
    }

    generateFieldMappingUI() {
        const container = this.elements.fieldMappings;

        if (this.currentModelFields.length === 0) {
            container.innerHTML = '<div class="no-fields-message">请先选择笔记模板</div>';
            return;
        }

        let html = '';

        // 为每个模板字段生成映射选择器
        this.currentModelFields.forEach((fieldName, index) => {
            const isRequired = index < 2; // 前两个字段标记为推荐

            html += `
        <div class="field-mapping-row ${isRequired ? 'required' : ''}">
          <div class="field-label">
            ${isRequired ? '<span class="required-mark">*</span>' : ''}
            <span>${this.escapeHtml(fieldName)}</span>
          </div>
          <select class="field-mapping-select" data-field="${this.escapeHtml(fieldName)}">
            <option value="">不导入</option>
          </select>
        </div>
      `;
        });

        // 添加标签字段
        html += `
      <div class="field-mapping-row">
        <div class="field-label">
          <span>标签 (Tags)</span>
          <span class="field-type">可选</span>
        </div>
        <select class="field-mapping-select" data-field="__tags__">
          <option value="">不导入</option>
        </select>
      </div>
    `;

        if (this.currentModelFields.length > 0) {
            html += '<div class="mapping-hint">* 标记的字段建议填写</div>';
        }

        container.innerHTML = html;

        // 如果已有解析的数据，填充选项
        if (this.parsedData) {
            this.populateFieldMappingOptions();
        }

        // 添加事件监听器
        container.querySelectorAll('.field-mapping-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const fieldName = e.target.dataset.field;
                this.fieldMappings[fieldName] = e.target.value;
                console.log('Field mapping updated:', this.fieldMappings);
            });
        });
    }

    populateFieldMappingOptions() {
        if (!this.parsedData) return;

        const { headers } = this.parsedData;
        const selects = this.elements.fieldMappings.querySelectorAll('.field-mapping-select');

        selects.forEach(select => {
            const fieldName = select.dataset.field;
            const currentValue = select.value;

            // 清空并重新填充选项
            select.innerHTML = '<option value="">不导入</option>';
            headers.forEach((header, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = `${index + 1}: ${header}`;
                select.appendChild(option);
            });

            // 自动匹配字段（不区分大小写）
            const matchIndex = headers.findIndex(h =>
                h.toLowerCase() === fieldName.toLowerCase() ||
                h.toLowerCase() === fieldName.toLowerCase().replace(/\s+/g, '') ||
                (fieldName === '__tags__' && h.toLowerCase() === 'tags')
            );

            if (matchIndex !== -1) {
                select.value = matchIndex;
                this.fieldMappings[fieldName] = matchIndex.toString();
            } else if (currentValue) {
                select.value = currentValue;
            }
        });

        console.log('Auto-mapped fields:', this.fieldMappings);
    }

    async updateAnkiUrl(url) {
        await chrome.storage.local.set({ ankiUrl: url });
        this.anki = new AnkiConnect(url);
    }

    async testAnkiConnection() {
        this.showStatus('正在测试连接...', 'info');
        const result = await this.anki.testConnection();

        if (result.success) {
            this.showStatus(`✓ 连接成功! AnkiConnect 版本: ${result.version}`, 'success');
            await this.loadDecksAndModels();
        } else {
            this.showStatus(`✗ ${result.error}`, 'error');
        }
    }

    parseCSVText() {
        const text = this.elements.csvText.value.trim();
        if (!text) {
            this.showStatus('请输入CSV内容', 'error');
            return;
        }

        this.csvData = text;
        this.reloadPreview();
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.elements.fileName.textContent = file.name;

        const reader = new FileReader();
        reader.onload = (e) => {
            this.csvData = e.target.result;
            this.reloadPreview();
        };
        reader.readAsText(file, 'UTF-8');
    }

    reloadPreview() {
        if (!this.csvData) return;

        try {
            const delimiter = this.elements.delimiter.value === '\\t' ? '\t' : this.elements.delimiter.value;
            const parser = new CSVParser(delimiter);
            this.parsedData = parser.parse(this.csvData);

            const { headers, rows } = this.parsedData;

            if (headers.length === 0 || rows.length === 0) {
                this.showStatus('CSV 数据为空或格式不正确', 'error');
                return;
            }

            this.displayPreview(headers, rows);
            this.populateFieldMappingOptions();
            this.elements.importBtn.disabled = false;
            this.showStatus(`✓ 成功解析 ${rows.length} 行数据`, 'success');
        } catch (error) {
            this.showStatus(`✗ 解析失败: ${error.message}`, 'error');
            console.error('Parse error:', error);
        }
    }

    displayPreview(headers, rows) {
        const maxRows = 5;
        const previewRows = rows.slice(0, maxRows);

        let html = '<thead><tr>';
        headers.forEach((header, index) => {
            html += `<th>${index + 1}</th>`;
        });
        html += '</tr><tr>';
        headers.forEach(header => {
            html += `<th>${this.escapeHtml(header)}</th>`;
        });
        html += '</tr></thead><tbody>';

        previewRows.forEach(row => {
            html += '<tr>';
            row.forEach(cell => {
                const displayText = cell.length > 80 ? cell.substring(0, 80) + '...' : cell;
                html += `<td title="${this.escapeHtml(cell)}">${this.escapeHtml(displayText)}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody>';
        this.elements.previewTable.innerHTML = html;
        this.elements.totalRows.textContent = rows.length;
        this.elements.preview.style.display = 'block';
    }

    async importToAnki() {
        if (!this.parsedData) {
            this.showStatus('请先解析CSV数据', 'error');
            return;
        }

        if (this.currentModelFields.length === 0) {
            this.showStatus('请先选择笔记模板', 'error');
            return;
        }

        const connected = await this.anki.testConnection();
        if (!connected.success) {
            this.showStatus('无法连接到 Anki,请确保 Anki 已启动', 'error');
            return;
        }

        this.elements.importBtn.disabled = true;
        this.showProgress(0);

        try {
            const { headers, rows } = this.parsedData;
            const modelName = this.elements.noteType.value;
            const deckName = this.elements.deck.value;
            const tagAll = this.elements.tagAll.value.trim();
            const tagUpdated = this.elements.tagUpdated.value.trim();
            const duplicatePolicy = this.elements.duplicatePolicy.value;

            // 保存牌组选择
            await chrome.storage.local.set({ lastDeck: deckName });

            let successCount = 0;
            let updateCount = 0;
            let skipCount = 0;
            let errorCount = 0;
            const errors = [];

            console.log('=== 开始导入 ===');
            console.log(`总行数: ${rows.length}`);
            console.log(`模板: ${modelName}`);
            console.log(`牌组: ${deckName}`);
            console.log(`模板字段:`, this.currentModelFields);
            console.log(`字段映射:`, this.fieldMappings);
            console.log(`重复策略: ${duplicatePolicy}`);

            for (let i = 0; i < rows.length; i++) {
                try {
                    const row = rows[i];

                    console.log(`\n--- 处理第 ${i + 1} 行 ---`);
                    console.log('原始数据:', row);

                    // 检查行是否为空
                    if (row.every(cell => !cell.trim())) {
                        console.log(`❌ 跳过空行 ${i + 1}`);
                        skipCount++;
                        continue;
                    }

                    // 构建字段对象
                    const fields = {};

                    // 根据映射构建字段
                    this.currentModelFields.forEach(fieldName => {
                        const csvColumnIndex = this.fieldMappings[fieldName];
                        if (csvColumnIndex !== undefined && csvColumnIndex !== '') {
                            const value = row[parseInt(csvColumnIndex)] || '';
                            fields[fieldName] = value;
                        } else {
                            fields[fieldName] = '';
                        }
                    });

                    console.log('构建的字段:', fields);

                    // 检查是否至少有一个字段有内容
                    const hasContent = Object.values(fields).some(v => v.trim());
                    if (!hasContent) {
                        console.log(`❌ 跳过无内容行 ${i + 1}`);
                        skipCount++;
                        continue;
                    }

                    // 构建标签
                    let tags = [];
                    if (tagAll) tags.push(tagAll);

                    const tagsColumnIndex = this.fieldMappings['__tags__'];
                    if (tagsColumnIndex !== undefined && tagsColumnIndex !== '') {
                        const tagsValue = row[parseInt(tagsColumnIndex)] || '';
                        if (tagsValue) {
                            const rowTags = tagsValue.split(/[,\s]+/).filter(t => t.trim());
                            tags = tags.concat(rowTags);
                        }
                    }

                    const note = {
                        deckName: deckName,
                        modelName: modelName,
                        fields: fields,
                        tags: tags,
                        options: {
                            allowDuplicate: true  // 先强制允许重复，看看是否能导入
                        }
                    };

                    console.log('准备发送的笔记:', JSON.stringify(note, null, 2));

                    // 尝试添加笔记
                    try {
                        const noteId = await this.anki.addNote(note);
                        console.log(`✅ 成功添加笔记 ${i + 1}, ID: ${noteId}`);
                        successCount++;
                    } catch (error) {
                        console.error(`❌ 导入笔记 ${i + 1} 失败:`, error);
                        console.error('错误详情:', error.message);

                        // 详细记录错误
                        const errorDetail = {
                            row: i + 1,
                            error: error.message,
                            note: note
                        };
                        console.error('完整错误信息:', errorDetail);

                        if (error.message.includes('duplicate') || error.message.includes('already exists')) {
                            console.log(`⚠️ 检测到重复笔记 ${i + 1}`);

                            if (duplicatePolicy === 'skip') {
                                console.log(`⏭️ 跳过重复笔记 ${i + 1}`);
                                skipCount++;
                            } else if (duplicatePolicy === 'update') {
                                console.log(`🔄 尝试更新笔记 ${i + 1}`);
                                // 查找并更新现有笔记
                                try {
                                    // 使用第一个非空字段的值来查找
                                    const firstFieldValue = Object.values(fields).find(v => v.trim());
                                    if (firstFieldValue) {
                                        // 转义特殊字符
                                        const searchValue = firstFieldValue.substring(0, 50).replace(/"/g, '\\"');
                                        const query = `deck:"${deckName}" "${searchValue}"`;
                                        console.log('搜索查询:', query);

                                        const noteIds = await this.anki.findNotes(query);
                                        console.log('找到的笔记ID:', noteIds);

                                        if (noteIds.length > 0) {
                                            await this.anki.updateNoteFields(noteIds[0], fields);
                                            if (tagUpdated) {
                                                await this.anki.addTags([noteIds[0]], tagUpdated);
                                            }
                                            console.log(`✅ 更新笔记 ${i + 1}, ID: ${noteIds[0]}`);
                                            updateCount++;
                                        } else {
                                            console.log(`⚠️ 未找到要更新的笔记 ${i + 1}`);
                                            skipCount++;
                                        }
                                    } else {
                                        console.log(`⚠️ 没有可用于搜索的字段值 ${i + 1}`);
                                        skipCount++;
                                    }
                                } catch (updateError) {
                                    console.error(`❌ 更新笔记 ${i + 1} 失败:`, updateError);
                                    errorCount++;
                                    errors.push(`行 ${i + 2}: 更新失败 - ${updateError.message}`);
                                }
                            } else {
                                // duplicate 策略但还是失败了
                                errorCount++;
                                errors.push(`行 ${i + 2}: ${error.message}`);
                            }
                        } else {
                            // 其他类型的错误
                            errorCount++;
                            errors.push(`行 ${i + 2}: ${error.message}`);
                        }
                    }

                    this.showProgress(((i + 1) / rows.length) * 100);

                    // 添加短暂延迟，避免请求过快
                    await new Promise(resolve => setTimeout(resolve, 50));

                } catch (error) {
                    console.error(`❌ 处理行 ${i + 1} 时出错:`, error);
                    errorCount++;
                    errors.push(`行 ${i + 2}: ${error.message}`);
                }
            }

            console.log('\n=== 导入完成 ===');
            console.log('统计:', { successCount, updateCount, skipCount, errorCount });

            let statusMsg = `✓ 导入完成!\n成功: ${successCount}`;
            if (updateCount > 0) statusMsg += `, 更新: ${updateCount}`;
            if (skipCount > 0) statusMsg += `, 跳过: ${skipCount}`;
            if (errorCount > 0) statusMsg += `, 失败: ${errorCount}`;

            if (errors.length > 0 && errors.length <= 5) {
                statusMsg += '\n\n错误详情:\n' + errors.join('\n');
            } else if (errors.length > 5) {
                statusMsg += `\n\n显示前5个错误:\n` + errors.slice(0, 5).join('\n');
                statusMsg += `\n... 还有 ${errors.length - 5} 个错误`;
            }

            this.showStatus(statusMsg, errorCount > 0 ? 'error' : 'success');
        } catch (error) {
            console.error('❌ 导入过程出错:', error);
            this.showStatus(`✗ 导入失败: ${error.message}`, 'error');
        } finally {
            this.elements.importBtn.disabled = false;
            setTimeout(() => {
                this.elements.progress.style.display = 'none';
            }, 2000);
        }
    }


    showProgress(percent) {
        this.elements.progress.style.display = 'block';
        this.elements.progressFill.style.width = `${percent}%`;
        this.elements.progressText.textContent = `${Math.round(percent)}%`;
    }

    showStatus(message, type) {
        this.elements.status.textContent = message;
        this.elements.status.className = `status-message ${type}`;
        this.elements.status.style.whiteSpace = 'pre-line';

        if (type === 'success') {
            setTimeout(() => {
                this.elements.status.style.display = 'none';
            }, 8000);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new AnkiImporter();
});
