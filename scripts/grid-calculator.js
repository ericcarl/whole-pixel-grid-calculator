(function () {

    // ── State ──────────────────────────────────────────────────────────────────
    let gridWidth   = 840;
    let columnCount = 6;
    let colWidth    = 125;
    let gutterWidth = 18;
    let marginWidth = 0;
    let lastTyped      = 'width'; // most recently manually typed field
    let colWidthManual    = false;
    let colWidthAuto   = true;
    let matchGutter    = false;
    let savedMarginWidth = null; // margin value before Match Gutter was enabled
    let skipNextTransition = false; // suppress preview transitions for snap actions

    // ── DOM refs ───────────────────────────────────────────────────────────────
    const totalWidthInput = document.getElementById('total-width-input');
    const countInput     = document.getElementById('column-count-input');
    const colWidthInput  = document.getElementById('column-width-input');
    const gutterInput    = document.getElementById('gutter-width-input');
    const marginInput    = document.getElementById('margin-input');
    const totalWidthValues = document.getElementById('total-width-values');
    const countValues    = document.getElementById('column-count-values');
    const colWidthValues = document.getElementById('column-width-values');
    const gutterValues   = document.getElementById('gutter-width-values');
    const marginValues   = document.getElementById('margin-values');
    const totalWidthPrev = document.getElementById('total-width-prev');
    const totalWidthNext = document.getElementById('total-width-next');
    const countPrev      = document.getElementById('column-count-prev');
    const countNext      = document.getElementById('column-count-next');
    const colWidthAutoCheck = document.getElementById('column-width-auto');
    const colWidthManualCheck      = document.getElementById('column-width-manual');
    const colWidthPrev   = document.getElementById('column-width-prev');
    const colWidthNext   = document.getElementById('column-width-next');
    const gutterPrev     = document.getElementById('gutter-width-prev');
    const gutterNext     = document.getElementById('gutter-width-next');
    const marginPrev     = document.getElementById('margin-prev');
    const marginNext     = document.getElementById('margin-next');
    const marginMatchGutter = document.getElementById('margin-match-gutter');
    const marginTrim        = document.getElementById('margin-trim');
    const previewTotalWidth = document.getElementById('preview-total-width');
    const previewInnerWidth = document.getElementById('preview-inner-width');
    const [gridStatusResolved, gridStatusUnresolved] = document.querySelectorAll('.grid-state-container');
    const gridPreview    = document.getElementById('grid-preview');
    const previewScale   = document.getElementById('preview-scale');

    // Persistent preview elements — margins start at width:0 (invisible, zero space)
    const leftMarginDiv  = document.createElement('div');
    leftMarginDiv.className      = 'margin margin-left';
    leftMarginDiv.style.cssText  = 'flex-shrink:0;width:0px';
    gridPreview.appendChild(leftMarginDiv);

    const innerGridDiv = document.createElement('div');
    innerGridDiv.className      = 'inner-grid';
    innerGridDiv.style.cssText  = 'flex:1;min-width:0;display:flex;background-color:var(--color-gutter-resolved)';
    innerGridDiv._colCount      = null; // null = first render, skip transition suppression
    gridPreview.appendChild(innerGridDiv);

    const rightMarginDiv = document.createElement('div');
    rightMarginDiv.className     = 'margin margin-right';
    rightMarginDiv.style.cssText = 'flex-shrink:0;width:0px';
    gridPreview.appendChild(rightMarginDiv);

    // ── Math helpers ───────────────────────────────────────────────────────────

    // Grid width minus both margins = the inner space for columns + gutters.
    function innerWidth() {
        return gridWidth - 2 * marginWidth;
    }

    function isWholePixel() {
        const iW = innerWidth();
        const inner = iW - (columnCount - 1) * gutterWidth;
        if (inner <= 0) return false;
        // When locked, verify the exact locked colWidth satisfies the formula.
        if (colWidthManual) return inner === columnCount * colWidth;
        return inner % columnCount === 0;
    }

    function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

    function getDivisors(n) {
        const result = [];
        for (let i = 1; i <= n; i++) {
            if (n % i === 0) result.push(i);
        }
        return result;
    }

    function windowAround(arr, target, count = 7) {
        if (arr.length <= count) return arr.slice();
        const nearestIdx = arr.reduce((best, val, i) =>
            Math.abs(val - target) < Math.abs(arr[best] - target) ? i : best, 0);
        const half  = Math.floor(count / 2);
        const start = Math.max(0, Math.min(nearestIdx - half, arr.length - count));
        return arr.slice(start, start + count);
    }

    // Valid n: divisors of (innerWidth + g)
    function validColumnCounts(g) {
        const iW  = innerWidth();
        const key = iW + g;
        if (key <= 0) return [];
        return getDivisors(key).filter(n => iW - (n - 1) * g > 0);
    }

    // Valid W values form a series: W = k*n + (n-1)*g + 2*m, step = n
    function validGridWidthsNear(n, g, near, count = 7) {
        const base  = (n - 1) * g + 2 * marginWidth;
        const nearK = Math.max(1, Math.round((near - base) / n));
        const half  = Math.floor(count / 2);
        const result = [];
        for (let i = -half; i <= half; i++) {
            const W = (nearK + i) * n + base;
            if (W >= n + base) result.push(W);
        }
        while (result.length < count) result.push(result[result.length - 1] + n);
        return result;
    }

    // Valid g values.
    // Match Gutter off: g ≡ −innerWidth (mod n), step = n (margin is fixed).
    // Match Gutter on:  g ≡ W (mod n), step = n (margin moves with gutter, formula becomes W = n*c + (n+1)*g).
    function getValidGutterList(n) {
        if (n <= 1) return [0];
        if (matchGutter) {
            const W    = gridWidth;
            const r    = ((W % n) + n) % n;
            const maxG = Math.floor((W - n) / (n + 1));
            const result = [];
            for (let g = r; g <= maxG && result.length < 100; g += n) result.push(g);
            return result;
        }
        const iW = innerWidth();
        const r    = ((-iW % n) + n) % n;
        const maxG = Math.floor((iW - n) / (n - 1));
        const result = [];
        for (let g = r; g <= maxG && result.length < 100; g += n) result.push(g);
        return result;
    }

    // Valid m values: 2*m ≡ W+g (mod n), step = n/gcd(2,n)
    function getValidMarginList(n, g) {
        const W = gridWidth;
        if (n <= 0) return [0];
        const maxM = n <= 1
            ? Math.floor((W - 1) / 2)
            : Math.floor((W - (n - 1) * g - n) / 2);
        if (maxM < 0) return [];
        const d   = gcd(2, n);
        const rhs = ((W + g) % n + n) % n;
        if (rhs % d !== 0) return []; // no solutions (n even, W+g odd)
        const step = n / d;
        let m0;
        if (n % 2 === 0) {
            m0 = (rhs / 2) % step;
        } else {
            const inv2 = (n + 1) / 2; // modular inverse of 2 mod n (odd n only)
            m0 = (rhs * inv2) % n;
        }
        const result = [];
        for (let m = m0; m <= maxM && result.length < 100; m += step) {
            result.push(m);
        }
        return result;
    }

    // Consecutive integers near `near`, clamped to a minimum value.
    function intOptionsNear(near, count = 7, min = 1) {
        const center = Math.max(min, Math.round(near));
        const half   = Math.floor(count / 2);
        const result = [];
        for (let i = -half; i <= half; i++) {
            const v = center + i;
            if (v >= min) result.push(v);
        }
        while (result.length < count) result.push(result[result.length - 1] + 1);
        return result;
    }

    function colWidthOptionsNear(near, count = 7) { return intOptionsNear(near, count, 1); }

    // ── Rendering ──────────────────────────────────────────────────────────────

    function renderOptions(container, values, current) {
        container.innerHTML = '';
        if (values.length === 0) {
            const el = document.createElement('span');
            el.className = 'no-options';
            el.textContent = 'No options.';
            container.appendChild(el);
            return;
        }
        values.forEach(val => {
            const el = document.createElement('button');
            el.type        = 'button';
            el.className   = 'button-general' + (val === current ? ' value-current' : '');
            const span = document.createElement('span');
            span.textContent = val;
            el.appendChild(span);
            el.addEventListener('click', () => onOptionClick(container, val));
            container.appendChild(el);
        });
    }

    function renderPreview() {
        if (skipNextTransition) {
            gridPreview.classList.add('no-transition');
            skipNextTransition = false;
            requestAnimationFrame(() => gridPreview.classList.remove('no-transition'));
        }

        const hasMargin = marginWidth > 0;
        if (hasMargin) {
            previewTotalWidth.textContent = 'Total Width: ' + gridWidth + 'px';
            previewInnerWidth.textContent = 'Grid Width: ' + innerWidth() + 'px';
        }
        previewTotalWidth.classList.toggle('visible', hasMargin);
        previewInnerWidth.classList.toggle('visible', hasMargin);

        gridPreview.style.width  = gridWidth + 'px';
        gridPreview.style.display = 'flex';

        leftMarginDiv.style.width  = marginWidth + 'px';
        rightMarginDiv.style.width = marginWidth + 'px';

        // Suppress transitions when column count changes — a reshuffled layout
        // shouldn't animate; snap it, then re-enable for future changes.
        // Suppress structural transitions when column count changes — a reshuffled layout
        // shouldn't animate; snap it, then re-enable for future changes.
        const countChanged = innerGridDiv._colCount !== null && innerGridDiv._colCount !== columnCount;
        if (countChanged) innerGridDiv.classList.add('snap-layout');

        innerGridDiv.style.columnGap = gutterWidth + 'px';

        const wholePx = isWholePixel();
        innerGridDiv.style.backgroundColor = wholePx ? 'var(--color-gutter-resolved)' : 'var(--color-gutter-unresolved)';

        while (innerGridDiv.children.length > columnCount) innerGridDiv.lastChild.remove();
        while (innerGridDiv.children.length < columnCount) innerGridDiv.appendChild(document.createElement('div'));
        Array.from(innerGridDiv.children).forEach((col, i) => {
            const isAlt = gutterWidth === 0 && i % 2 !== 0;
            col.style.width = colWidth + 'px';
            col.className = isAlt ? 'column-alt' : 'column';
            col.style.backgroundColor = wholePx ? '' : (isAlt ? 'var(--color-gutter-unresolved)' : 'var(--color-column-unresolved)');
        });

        innerGridDiv._colCount = columnCount;
        if (countChanged) requestAnimationFrame(() => innerGridDiv.classList.remove('snap-layout'));

        updatePreviewScale();
    }

    function updatePreviewScale() {
        const available = gridPreview.parentElement.getBoundingClientRect().width;
        const scale = available / gridWidth;
        if (scale < 1) {
            gridPreview.style.transform = `scaleX(${scale})`;
            gridPreview.style.transformOrigin = 'top left';
            previewScale.textContent = 'Scale: ' + Math.round(scale * 100) + '%';
            previewScale.classList.add('visible');
        } else {
            gridPreview.style.transform = '';
            gridPreview.style.transformOrigin = '';
            previewScale.classList.remove('visible');
        }
    }

    // ── Core refresh ───────────────────────────────────────────────────────────

    function refresh() {
        // Match Gutter syncs margin to gutter before any calculations.
        if (matchGutter) marginWidth = gutterWidth;

        if (!colWidthAuto && (lastTyped === 'column' || lastTyped === 'margin' || lastTyped === 'gutter' || lastTyped === 'count') && !colWidthManual) {
            // Manual mode: c is the driver — recalculate W so the constraint always holds.
            gridWidth = columnCount * colWidth + (columnCount - 1) * gutterWidth + 2 * marginWidth;
        } else if (!colWidthManual) {
            // W, n, g, or m is the driver: derive c.
            colWidth = (innerWidth() - (columnCount - 1) * gutterWidth) / columnCount;
            // Clamp: ensure colWidth ≥ 1 by pulling margin (and gutter if Match Gutter) back.
            if (colWidth < 1) {
                if (matchGutter) {
                    gutterWidth = Math.max(0, Math.floor((gridWidth - columnCount) / (columnCount + 1)));
                    marginWidth = gutterWidth;
                } else {
                    marginWidth = Math.max(0, Math.floor((gridWidth - columnCount - (columnCount - 1) * gutterWidth) / 2));
                }
                colWidth = (innerWidth() - (columnCount - 1) * gutterWidth) / columnCount;
            }
        }
        // else colWidthManual: both W and c are fixed — explore n/g/m

        const wholePx = isWholePixel();
        gridStatusResolved.classList.toggle('visible', wholePx);
        gridStatusUnresolved.classList.toggle('visible', !wholePx);
        const cur     = wholePx
            ? { width: gridWidth, count: columnCount, col: colWidth, gutter: gutterWidth, margin: marginWidth }
            : {};

        totalWidthInput.value    = gridWidth;
        countInput.value    = columnCount;
        colWidthInput.value = Number.isInteger(colWidth) ? colWidth : colWidth.toFixed(2);
        gutterInput.value   = gutterWidth;
        marginInput.value   = Number.isInteger(marginWidth) ? marginWidth : marginWidth.toFixed(2);

        [totalWidthInput, countInput, colWidthInput, gutterInput, marginInput].forEach(el =>
            el.classList.remove('unresolved'));

        if (!wholePx) {
            if (colWidthManual) {
                // W and c are both fixed — highlight the free variables unless just typed.
                if (lastTyped !== 'count')  countInput.classList.add('unresolved');
                if (lastTyped !== 'gutter') gutterInput.classList.add('unresolved');
                if (lastTyped !== 'margin') marginInput.classList.add('unresolved');
            } else {
                colWidthInput.classList.add('unresolved');
            }
        }

        // Compute locked-mode solving values once — used by both renderOptions and disabled states.
        // NaN means no valid integer solution for that variable given the other current values.
        let lockedWOpt = NaN, lockedNOpt = NaN, lockedGOpt = NaN, lockedMOpt = NaN;
        if (colWidthManual) {
            lockedWOpt = columnCount * colWidth + (columnCount - 1) * gutterWidth + 2 * marginWidth;
            const cg   = colWidth + gutterWidth;
            const rawN = cg > 0 ? (innerWidth() + gutterWidth) / cg : NaN;
            if (Number.isInteger(rawN) && rawN >= 1) lockedNOpt = rawN;
            if (matchGutter) {
                const rawG = (gridWidth - columnCount * colWidth) / (columnCount + 1);
                if (Number.isInteger(rawG) && rawG >= 0) lockedGOpt = rawG;
            } else {
                const rawG = columnCount > 1 ? (innerWidth() - columnCount * colWidth) / (columnCount - 1) : NaN;
                if (Number.isInteger(rawG) && rawG >= 0) lockedGOpt = rawG;
                const rawM = (gridWidth - columnCount * colWidth - (columnCount - 1) * gutterWidth) / 2;
                if (Number.isInteger(rawM) && rawM >= 0) lockedMOpt = rawM;
            }
        }

        // Only compute the valid margin list when it's needed (unlocked, non-matchGutter path).
        const validMarginList = (!colWidthManual && !matchGutter)
            ? getValidMarginList(columnCount, gutterWidth) : null;

        if (colWidthManual) {
            renderOptions(totalWidthValues,  [lockedWOpt], cur.width);
            renderOptions(countValues,  isNaN(lockedNOpt) ? [] : [lockedNOpt], cur.count);
            colWidthValues.innerHTML = '';
            renderOptions(gutterValues, isNaN(lockedGOpt) ? [] : [lockedGOpt], cur.gutter);
            if (matchGutter) {
                marginValues.innerHTML = '';
            } else {
                renderOptions(marginValues, isNaN(lockedMOpt) ? [] : [lockedMOpt], cur.margin);
            }
        } else if (!colWidthAuto) {
            renderOptions(totalWidthValues,    validGridWidthsNear(columnCount, gutterWidth, gridWidth), cur.width);
            renderOptions(countValues,    intOptionsNear(columnCount, 7, 1), cur.count);
            renderOptions(colWidthValues, colWidthOptionsNear(colWidth), cur.col);
            renderOptions(gutterValues,   intOptionsNear(gutterWidth, 7, 0), cur.gutter);
            renderOptions(marginValues,   intOptionsNear(marginWidth, 7, 0), cur.margin);
        } else {
            renderOptions(totalWidthValues,    validGridWidthsNear(columnCount, gutterWidth, gridWidth), cur.width);
            renderOptions(countValues,    windowAround(validColumnCounts(gutterWidth), columnCount), cur.count);
            renderOptions(colWidthValues, colWidthOptionsNear(colWidth), cur.col);
            renderOptions(gutterValues,   windowAround(getValidGutterList(columnCount), gutterWidth), cur.gutter);
            renderOptions(marginValues,   matchGutter ? intOptionsNear(marginWidth, 7, 0)
                : windowAround(validMarginList, marginWidth), cur.margin);
        }

        renderPreview();

        // ── Disabled states ───────────────────────────────────────────────────

        const wBase    = (columnCount - 1) * gutterWidth + 2 * marginWidth;
        const wMinimum = columnCount + wBase;
        const wPrevVal = (gridWidth - wBase) % columnCount === 0
            ? gridWidth - columnCount
            : Math.floor((gridWidth - wBase) / columnCount) * columnCount + wBase;
        totalWidthInput.disabled = false;
        totalWidthPrev.disabled = colWidthManual ? true : wPrevVal < wMinimum;
        totalWidthNext.disabled = colWidthManual ? true : false;
        totalWidthValues.querySelectorAll('button').forEach(btn => btn.disabled = false);

        if (colWidthManual) {
            countPrev.disabled = true;
            countNext.disabled = true;
        } else if (!colWidthAuto) {
            countPrev.disabled = columnCount <= 1;
            countNext.disabled = false;
        } else {
            const validCounts = validColumnCounts(gutterWidth);
            const countIdx    = validCounts.indexOf(columnCount);
            countPrev.disabled = !(countIdx > 0 || (countIdx === -1 && validCounts.some(n => n < columnCount)));
            countNext.disabled = !(countIdx !== -1 && countIdx < validCounts.length - 1 || countIdx === -1 && validCounts.some(n => n > columnCount));
        }

        const cPrevVal = Number.isInteger(colWidth) ? colWidth - 1 : Math.floor(colWidth);
        colWidthPrev.disabled  = colWidthAuto || colWidthManual || cPrevVal < 1;
        colWidthNext.disabled  = colWidthAuto || colWidthManual;
        colWidthInput.disabled = colWidthAuto;
        colWidthManualCheck.disabled  = colWidthAuto;
        colWidthValues.querySelectorAll('button').forEach(btn => btn.disabled = colWidthAuto);

        if (colWidthManual) {
            gutterPrev.disabled = true;
            gutterNext.disabled = true;
        } else if (!colWidthAuto) {
            gutterPrev.disabled = gutterWidth <= 0;
            gutterNext.disabled = false;
        } else {
            const validGutters = getValidGutterList(columnCount);
            const gutterIdx    = validGutters.indexOf(gutterWidth);
            gutterPrev.disabled = !(gutterIdx > 0 || (gutterIdx === -1 && validGutters.some(g => g < gutterWidth)));
            gutterNext.disabled = !(gutterIdx !== -1 && gutterIdx < validGutters.length - 1 || gutterIdx === -1 && validGutters.some(g => g > gutterWidth));
        }

        // Margin: all controls disabled when matchGutter.
        marginTrim.disabled  = marginWidth === 0 || gridWidth - 2 * marginWidth < columnCount + (columnCount - 1) * gutterWidth;
        marginInput.disabled = matchGutter;
        marginValues.querySelectorAll('button').forEach(btn => btn.disabled = matchGutter);
        if (matchGutter || colWidthManual) {
            marginPrev.disabled = true;
            marginNext.disabled = true;
        } else if (!colWidthAuto) {
            marginPrev.disabled = marginWidth <= 0;
            marginNext.disabled = false;
        } else {
            const marginIdx    = validMarginList.indexOf(marginWidth);
            marginPrev.disabled = !(marginIdx > 0 || (marginIdx === -1 && validMarginList.some(m => m < marginWidth)));
            marginNext.disabled = !(marginIdx !== -1 && marginIdx < validMarginList.length - 1 || marginIdx === -1 && validMarginList.some(m => m > marginWidth));
        }
    }

    // ── History (Undo) ─────────────────────────────────────────────────────────

    const history = [];

    function pushHistory(noTransitionOnUndo = false) {
        history.push({ gridWidth, columnCount, colWidth, gutterWidth, marginWidth,
                       lastTyped, colWidthManual, colWidthAuto, matchGutter, noTransitionOnUndo });
        if (history.length > 100) history.shift();
    }

    function undo() {
        if (history.length === 0) return;
        const s = history.pop();
        if (s.noTransitionOnUndo) skipNextTransition = true;
        gridWidth = s.gridWidth; columnCount = s.columnCount; colWidth = s.colWidth;
        gutterWidth = s.gutterWidth; marginWidth = s.marginWidth; lastTyped = s.lastTyped;
        colWidthManual = s.colWidthManual;
        colWidthAuto = s.colWidthAuto; matchGutter = s.matchGutter;
        colWidthAutoCheck.checked = colWidthAuto;
        colWidthManualCheck.checked      = colWidthManual;
        marginMatchGutter.checked = matchGutter;
        refresh();
    }

    // ── Option click ───────────────────────────────────────────────────────────

    function onOptionClick(container, val) {
        pushHistory();
        if (container === totalWidthValues) {
            gridWidth = val;
            lastTyped = 'width';
        } else if (container === countValues) {
            columnCount = val;
            lastTyped = 'count';
            if (!colWidthAuto && !Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        } else if (container === colWidthValues) {
            colWidth = val;
            if (!colWidthManual) {
                gridWidth = columnCount * colWidth + (columnCount - 1) * gutterWidth + 2 * marginWidth;
            }
        } else if (container === gutterValues) {
            gutterWidth = val;
            lastTyped = 'gutter';
            if (!colWidthAuto && !Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        } else {
            marginWidth = val;
            lastTyped = 'margin';
            if (!colWidthAuto && !Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        }
        refresh();
    }

    // ── Text input handlers ────────────────────────────────────────────────────

    totalWidthInput.addEventListener('change', () => {
        const v = parseInt(totalWidthInput.value, 10);
        if (v > 0) { pushHistory(); gridWidth = v; lastTyped = 'width'; refresh(); }
        else { totalWidthInput.value = gridWidth; }
    });

    countInput.addEventListener('change', () => {
        const v = parseInt(countInput.value, 10);
        if (v > 0) { pushHistory(); columnCount = v; lastTyped = 'count'; if (!colWidthAuto && !Number.isInteger(colWidth)) colWidth = Math.round(colWidth); refresh(); }
        else { countInput.value = columnCount; }
    });

    colWidthInput.addEventListener('change', () => {
        const v = parseInt(colWidthInput.value, 10);
        if (v > 0) { pushHistory(); colWidth = v; lastTyped = 'column'; refresh(); }
        else { colWidthInput.value = Math.round(colWidth); }
    });

    gutterInput.addEventListener('change', () => {
        const v = parseInt(gutterInput.value, 10);
        if (!isNaN(v) && v >= 0) { pushHistory(); gutterWidth = v; lastTyped = 'gutter'; if (!colWidthAuto && !Number.isInteger(colWidth)) colWidth = Math.round(colWidth); refresh(); }
        else { gutterInput.value = gutterWidth; }
    });

    marginInput.addEventListener('change', () => {
        const v = parseInt(marginInput.value, 10);
        if (!isNaN(v) && v >= 0) { pushHistory(); marginWidth = v; lastTyped = 'margin'; if (!colWidthAuto && !Number.isInteger(colWidth)) colWidth = Math.round(colWidth); refresh(); }
        else { marginInput.value = marginWidth; }
    });

    // ── Prev / Next handlers ───────────────────────────────────────────────────

    totalWidthPrev.addEventListener('click', () => {
        pushHistory();
        if (colWidthManual) {
            gridWidth = Math.max(1, gridWidth - 1);
        } else {
            const n = columnCount, base = (n - 1) * gutterWidth + 2 * marginWidth;
            if ((gridWidth - base) % n === 0) {
                gridWidth = Math.max(base + n, gridWidth - n);
            } else {
                gridWidth = Math.max(base + n, Math.floor((gridWidth - base) / n) * n + base);
            }
        }
        lastTyped = 'width';
        refresh();
    });

    totalWidthNext.addEventListener('click', () => {
        pushHistory();
        if (colWidthManual) {
            gridWidth += 1;
        } else {
            const n = columnCount, base = (n - 1) * gutterWidth + 2 * marginWidth;
            const next = (gridWidth - base) % n === 0
                ? gridWidth + n
                : Math.ceil((gridWidth - base) / n) * n + base;
            gridWidth = Math.max(next, base + n);
        }
        lastTyped = 'width';
        refresh();
    });

    countPrev.addEventListener('click', () => {
        pushHistory();
        if (colWidthManual) {
            columnCount = Math.max(1, columnCount - 1);
        } else if (!colWidthAuto) {
            columnCount = Math.max(1, columnCount - 1);
            lastTyped = 'count';
            if (!Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        } else {
            const valid = validColumnCounts(gutterWidth);
            const idx   = valid.indexOf(columnCount);
            if (idx > 0) {
                columnCount = valid[idx - 1];
            } else if (idx === -1) {
                const smaller = valid.filter(n => n < columnCount);
                if (smaller.length) columnCount = smaller[smaller.length - 1];
            }
        }
        refresh();
    });

    countNext.addEventListener('click', () => {
        pushHistory();
        if (colWidthManual) {
            columnCount += 1;
        } else if (!colWidthAuto) {
            columnCount += 1;
            lastTyped = 'count';
            if (!Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        } else {
            const valid = validColumnCounts(gutterWidth);
            const idx   = valid.indexOf(columnCount);
            if (idx !== -1 && idx < valid.length - 1) {
                columnCount = valid[idx + 1];
            } else if (idx === -1) {
                const larger = valid.filter(n => n > columnCount);
                if (larger.length) columnCount = larger[0];
            }
        }
        refresh();
    });

    colWidthPrev.addEventListener('click', () => {
        pushHistory();
        colWidth = Number.isInteger(colWidth) ? colWidth - 1 : Math.floor(colWidth);
        colWidth = Math.max(1, colWidth);
        if (!colWidthManual) gridWidth = columnCount * colWidth + (columnCount - 1) * gutterWidth + 2 * marginWidth;
        refresh();
    });

    colWidthNext.addEventListener('click', () => {
        pushHistory();
        colWidth = Number.isInteger(colWidth) ? colWidth + 1 : Math.ceil(colWidth);
        if (!colWidthManual) gridWidth = columnCount * colWidth + (columnCount - 1) * gutterWidth + 2 * marginWidth;
        refresh();
    });

    gutterPrev.addEventListener('click', () => {
        pushHistory();
        if (colWidthManual) {
            gutterWidth = Math.max(0, gutterWidth - 1);
        } else if (!colWidthAuto) {
            gutterWidth = Math.max(0, gutterWidth - 1);
            lastTyped = 'gutter';
            if (!Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        } else {
            const valid = getValidGutterList(columnCount);
            const idx   = valid.indexOf(gutterWidth);
            if (idx > 0) {
                gutterWidth = valid[idx - 1];
            } else if (idx === -1) {
                const smaller = valid.filter(g => g < gutterWidth);
                if (smaller.length) gutterWidth = smaller[smaller.length - 1];
            }
        }
        refresh();
    });

    gutterNext.addEventListener('click', () => {
        pushHistory();
        if (colWidthManual) {
            gutterWidth += 1;
        } else if (!colWidthAuto) {
            gutterWidth += 1;
            lastTyped = 'gutter';
            if (!Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        } else {
            const valid = getValidGutterList(columnCount);
            const idx   = valid.indexOf(gutterWidth);
            if (idx !== -1 && idx < valid.length - 1) {
                gutterWidth = valid[idx + 1];
            } else if (idx === -1) {
                const larger = valid.filter(g => g > gutterWidth);
                if (larger.length) gutterWidth = larger[0];
            }
        }
        refresh();
    });

    marginPrev.addEventListener('click', () => {
        pushHistory();
        if (colWidthManual) {
            marginWidth = Math.max(0, marginWidth - 1);
        } else if (!colWidthAuto) {
            marginWidth = Math.max(0, marginWidth - 1);
            lastTyped = 'margin';
            if (!Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        } else {
            const valid = getValidMarginList(columnCount, gutterWidth);
            const idx   = valid.indexOf(marginWidth);
            if (idx > 0) {
                marginWidth = valid[idx - 1];
            } else if (idx === -1) {
                const smaller = valid.filter(m => m < marginWidth);
                if (smaller.length) marginWidth = smaller[smaller.length - 1];
            }
        }
        refresh();
    });

    marginNext.addEventListener('click', () => {
        pushHistory();
        if (colWidthManual) {
            marginWidth += 1;
        } else if (!colWidthAuto) {
            marginWidth += 1;
            lastTyped = 'margin';
            if (!Number.isInteger(colWidth)) colWidth = Math.round(colWidth);
        } else {
            const valid = getValidMarginList(columnCount, gutterWidth);
            const idx   = valid.indexOf(marginWidth);
            if (idx !== -1 && idx < valid.length - 1) {
                marginWidth = valid[idx + 1];
            } else if (idx === -1) {
                const larger = valid.filter(m => m > marginWidth);
                if (larger.length) marginWidth = larger[0];
            }
        }
        refresh();
    });

    colWidthAutoCheck.addEventListener('change', () => {
        pushHistory();
        colWidthAuto = colWidthAutoCheck.checked;
        if (colWidthAuto) { colWidthManual = false; colWidthManualCheck.checked = false; }
        refresh();
    });

    colWidthManualCheck.addEventListener('change', () => {
        pushHistory();
        colWidthManual = colWidthManualCheck.checked;
        if (colWidthManual) { colWidthAuto = false; colWidthAutoCheck.checked = false; }
        refresh();
    });

    marginMatchGutter.addEventListener('change', () => {
        pushHistory();
        matchGutter = marginMatchGutter.checked;
        if (matchGutter) {
            savedMarginWidth = marginWidth;
        } else if (savedMarginWidth !== null) {
            marginWidth = savedMarginWidth;
            savedMarginWidth = null;
        }
        refresh();
    });

    marginTrim.addEventListener('click', () => {
        if (marginWidth === 0) return;
        pushHistory(true);
        skipNextTransition = true;
        gridWidth -= 2 * marginWidth;
        marginWidth = 0;
        if (matchGutter) {
            matchGutter = false;
            marginMatchGutter.checked = false;
            savedMarginWidth = null;
        }
        refresh();
    });

    // ── Keyboard shortcuts ─────────────────────────────────────────────────────

    // Ctrl/Cmd+Z: undo app-level actions. When a text input is focused, let the
    // browser handle its own native undo instead.
    window.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undo();
        }
    });

    window.addEventListener('resize', () => {
        gridPreview.classList.add('no-transition');
        updatePreviewScale();
        requestAnimationFrame(() => gridPreview.classList.remove('no-transition'));
    });

    // ── About panel ────────────────────────────────────────────────────────────

    const about        = document.getElementById('about');
    const aboutTrigger = document.getElementById('about-trigger');
    const aboutClose   = document.getElementById('about-close');

    function setAboutVisible(visible) {
        about.classList.toggle('visible', visible);
        localStorage.setItem('aboutOpen', visible);
    }

    aboutTrigger.addEventListener('click', () => setAboutVisible(!about.classList.contains('visible')));
    aboutClose.addEventListener('click',   () => setAboutVisible(false));

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && about.classList.contains('visible')) {
            setAboutVisible(false);
        }
    });

    if (localStorage.getItem('aboutOpen') === 'true') about.classList.add('visible');

    // ── Column width variable ──────────────────────────────────────────────────
    const gridEl = document.querySelector('.grid-calculator');
    new ResizeObserver(() => {
        const colWidth = parseFloat(getComputedStyle(gridEl).gridTemplateColumns.split(' ')[0]);
        document.documentElement.style.setProperty('--flex-grid-unit', colWidth + 'px');
    }).observe(gridEl);

    // ── Init ───────────────────────────────────────────────────────────────────
    colWidthAutoCheck.checked    = colWidthAuto;
    colWidthManualCheck.checked  = colWidthManual;
    marginMatchGutter.checked    = matchGutter;
    refresh();

}());
